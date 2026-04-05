"""
qa_eval/run_eval.py — sequential eval runner
=============================================
Runs all QA_EVAL records sequentially against /api/web-ask (2s gap to stay
under the server's rate limiter: RL_MAX=12 per RL_WINDOW=20s).
Writes LAST_EVAL_RESULT / LAST_EVAL_DATE / NOTES back to Airtable.

Usage:
    PYTHONUNBUFFERED=1 python3 qa_eval/run_eval.py [--dry-run]
"""

import sys
sys.stdout.reconfigure(line_buffering=True)   # force line-buffered output

import urllib.request, urllib.parse, json, os, pathlib, time, re
import datetime

# ── env ───────────────────────────────────────────────────────────────────────
env_path = pathlib.Path(__file__).parent.parent / '.env'
for line in env_path.read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip())

API_KEY  = os.environ['AIRTABLE_API_KEY']
BASE_ID  = os.environ['AIRTABLE_BASE_ID']
AT_URL   = f"https://api.airtable.com/v0/{BASE_ID}/QA_EVAL"
BOT_URL  = "http://localhost:8080/api/web-ask"
SLUG     = "antique-split"
TODAY    = datetime.date.today().isoformat()
DRY_RUN  = '--dry-run' in sys.argv
GAP_S    = 2.1   # RL_MAX=12 per 20s → min gap=1.67s; use 2.1s for safety


def p(*a, **kw):
    print(*a, **kw, flush=True)


# ── API helpers ───────────────────────────────────────────────────────────────

def ask(question, retries=2):
    for attempt in range(retries + 1):
        body = json.dumps({"question": question, "slug": SLUG}).encode()
        req  = urllib.request.Request(BOT_URL, data=body, method="POST",
               headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=35) as r:
            d = json.loads(r.read())
        meta = d.get('meta', {})
        if meta.get('rate_limited') or meta.get('openai_rate_limited'):
            if attempt < retries:
                p(f"    ⚡ rate-limited, waiting 22s (attempt {attempt+1})...")
                time.sleep(22)
                continue
            raise RuntimeError('Rate-limited after retries')
        return d.get('answer', ''), meta
    raise RuntimeError('Unreachable')


def patch_record(rec_id, fields):
    body = json.dumps({"fields": fields}).encode()
    req  = urllib.request.Request(f"{AT_URL}/{rec_id}", data=body, method="PATCH",
           headers={"Authorization": f"Bearer {API_KEY}",
                    "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def fetch_qa_records():
    req = urllib.request.Request(f"{AT_URL}?pageSize=100",
          headers={"Authorization": f"Bearer {API_KEY}"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read()).get('records', [])


# ── evaluation logic ──────────────────────────────────────────────────────────

def route_ok(meta, expected_route):
    det  = meta.get('deterministic', '')
    link = meta.get('usedLinked', False)
    deterministic_routes = {'hotel_core','room_types','bed_types','rooms_by_view','room_amenities'}
    if expected_route in deterministic_routes:
        return det == expected_route, (f"det={det!r}" if det else f"GPT linked={link}")
    if expected_route in ('GPT+linked', 'GPT+matched'):
        return (not det) and link, (f"det={det!r}" if det else f"GPT linked={link}")
    if expected_route == 'GPT+fallback':
        return not det, (f"det={det!r}" if det else "GPT fallback")
    return True, "n/a"


def service_ok(meta, expected_id):
    if not expected_id:
        return True
    return any(r.get('id') == expected_id for r in meta.get('usedRecords', []))


BAD_PHRASES = [
    r'not available in the system',
    r'nije dostupno u sustavu',
    r'informaci[a-z]+ .{0,30} nisu dostupne',
    r'no information available',
    r'not have .{0,20} information',
]


def extract_must(text, verb_re):
    terms = []
    for m in re.finditer(rf'Must {verb_re}[:\s]+(.+?)(?:Must|\.|$)', text,
                         re.IGNORECASE | re.DOTALL):
        chunk = m.group(1).split('Must NOT')[0]
        for part in re.split(r'[,;]|\band\b', chunk):
            c = part.strip().rstrip('.')
            if 3 < len(c) < 80:
                terms.append(c.lower())
    return terms


def answer_quality(answer, can_en, can_hr, lang):
    ans_l = answer.lower()
    for pat in BAD_PHRASES:
        if re.search(pat, ans_l):
            snippet = re.search(pat, ans_l).group()
            return 'bad', [f'Failure phrase: "{snippet}"']
    canonical = (can_hr if lang == 'HR' and can_hr else can_en) or ''
    issues = []
    for term in extract_must(canonical, r'(?:include|mention|confirm|say|give|name|describe|state)'):
        words = [w for w in term.split() if len(w) > 3]
        if words and not all(w in ans_l for w in words):
            issues.append(f'Missing: {term[:50]}')
    for term in extract_must(canonical, r'NOT \w+'):
        words = [w for w in term.split() if len(w) > 3]
        if words and all(w in ans_l for w in words[:2]):
            issues.append(f'Forbidden: {term[:50]}')
    if not issues:
        return 'good', []
    if len(issues) == 1 and 'Forbidden' not in issues[0]:
        return 'partial', issues
    return 'bad', issues


def make_verdict(r_ok, s_ok, qual, issues, r_actual):
    if not r_ok:
        return 'fail',    f'Wrong route: {r_actual}'
    if not s_ok:
        return 'partial', f'Route ✓ wrong/missing service [{r_actual}]'
    if qual == 'bad':
        return 'fail',    ' | '.join(issues)
    if qual == 'partial':
        return 'partial', ' | '.join(issues)
    return 'pass', 'Route ✓  Service ✓  Answer ✓'


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    records = sorted(fetch_qa_records(),
                     key=lambda r: r['fields'].get('QA_ID', ''))
    total = len(records)
    p(f"Fetched {total} QA_EVAL records  (gap={GAP_S}s, sequential)\n")

    outcomes = {}

    for i, rec in enumerate(records):
        f           = rec['fields']
        qa_id       = f.get('QA_ID', rec['id'])
        lang        = f.get('LANG', 'EN')
        q_en        = f.get('QUESTION_EN', '').strip()
        q_hr        = f.get('QUESTION_HR', '').strip()
        exp_route   = f.get('EXPECTED_ROUTE', '')
        exp_svc     = f.get('EXPECTED_SERVICE_ID', '')
        can_en      = f.get('CANONICAL_ANSWER_EN', '')
        can_hr      = f.get('CANONICAL_ANSWER_HR', '')

        question = q_hr if lang == 'HR' else (q_en or q_hr)
        if not question:
            result, note = 'fail', 'No question text'
        else:
            try:
                answer, meta = ask(question)
                r_ok, r_actual = route_ok(meta, exp_route)
                s_ok           = service_ok(meta, exp_svc)
                qual, issues   = answer_quality(answer, can_en, can_hr, lang)
                result, note   = make_verdict(r_ok, s_ok, qual, issues, r_actual)
                used = meta.get('usedRecords', [])
                if used:
                    note += '  [' + ', '.join(r.get('naziv','?') for r in used[:2]) + ']'
            except Exception as e:
                result, note = 'fail', f'Error: {e}'

        outcomes[rec['id']] = (qa_id, result, note)
        p(f"[{i+1:02}/{total}] {qa_id:8} {result.upper():7}  {note[:95]}")

        if i < total - 1:
            time.sleep(GAP_S)

    # ── write back ────────────────────────────────────────────────────────────
    if not DRY_RUN:
        p(f"\nWriting {len(outcomes)} results to Airtable...")
        for j, (rec_id, (qa_id, result, note)) in enumerate(outcomes.items()):
            patch_record(rec_id, {
                'LAST_EVAL_RESULT': result,
                'LAST_EVAL_DATE':   TODAY,
                'NOTES':            note,
            })
            if (j + 1) % 5 == 0:
                time.sleep(0.3)
        p("Write-back complete.")

    # ── summary ───────────────────────────────────────────────────────────────
    by_result = {'pass': [], 'partial': [], 'fail': []}
    for _, (qa_id, result, note) in outcomes.items():
        by_result[result].append((qa_id, note))

    p(f"\n{'='*62}")
    p(f"EVAL RESULT  {TODAY}")
    p(f"{'='*62}")
    p(f"  PASS    {len(by_result['pass']):3} / {total}")
    p(f"  PARTIAL {len(by_result['partial']):3} / {total}")
    p(f"  FAIL    {len(by_result['fail']):3} / {total}")

    if by_result['fail']:
        p(f"\nFAILS:")
        for qa_id, note in sorted(by_result['fail']):
            p(f"  {qa_id}  {note[:88]}")

    if by_result['partial']:
        p(f"\nPARTIALS:")
        for qa_id, note in sorted(by_result['partial']):
            p(f"  {qa_id}  {note[:88]}")

    return by_result


if __name__ == '__main__':
    main()
