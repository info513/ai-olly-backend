"""
qa_eval/run_eval_targeted.py — targeted re-test for specific QA IDs
=====================================================================
Runs only the listed QA_IDs sequentially with a conservative gap.
Use after code fixes to confirm specific records without touching others.

Usage:
    PYTHONUNBUFFERED=1 python3 qa_eval/run_eval_targeted.py [--dry-run]
"""

import sys
sys.stdout.reconfigure(line_buffering=True)

import urllib.request, urllib.parse, json, os, pathlib, time, re
import datetime

# ── IDs to re-test ────────────────────────────────────────────────────────────
TARGET_IDS = {
    'QA-010',   # Was: det='hotel_core'  — Fix #5 should now let it reach GPT
    'QA-022',   # Was: det='hotel_core'  — luggage after check-out
    'QA-023',   # Was: det='hotel_core'  — late check-out request
    'QA-024',   # Was: det='hotel_core'  — early check-in
    'QA-032',   # Was: rate-limited — character group, unknown real result
    'QA-034',   # Was: rate-limited
    'QA-035',   # Was: rate-limited
    'QA-036',   # Was: rate-limited
    'QA-037',   # Was: rate-limited
    'QA-038',   # Was: rate-limited — HR check-in experience
    'QA-039',   # Was: rate-limited
    'QA-040',   # Was: rate-limited
}

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
GAP_S    = 3.0   # conservative: ~6.7 req/20s — well under RL_MAX=12


def p(*a, **kw):
    print(*a, **kw, flush=True)


# ── API helpers ───────────────────────────────────────────────────────────────

def ask(question, retries=3):
    for attempt in range(retries + 1):
        body = json.dumps({"question": question, "slug": SLUG}).encode()
        req  = urllib.request.Request(BOT_URL, data=body, method="POST",
               headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=40) as r:
            d = json.loads(r.read())
        meta = d.get('meta', {})
        if meta.get('rate_limited') or meta.get('openai_rate_limited'):
            wait = 25 if attempt < 2 else 45
            if attempt < retries:
                p(f"    ⚡ rate-limited, waiting {wait}s (attempt {attempt+1}/{retries})...")
                time.sleep(wait)
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


# ── evaluation logic (same as run_eval.py) ────────────────────────────────────

def route_ok(meta, expected_route):
    det  = meta.get('deterministic', '')
    link = meta.get('usedLinked', False)
    deterministic_routes = {'hotel_core','room_types','bed_types','rooms_by_view','room_amenities'}
    if expected_route in deterministic_routes:
        return det == expected_route, (f"det={det!r}" if det else f"GPT linked={link}")
    if expected_route in ('GPT+linked', 'GPT+matched'):
        return (not det) and link, (f"det={det!r}" if det else f"GPT usedLinked={link}")
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
    all_records = fetch_qa_records()
    records = [r for r in all_records
               if r['fields'].get('QA_ID', '') in TARGET_IDS]
    records.sort(key=lambda r: r['fields'].get('QA_ID', ''))

    total = len(records)
    p(f"Targeted re-test: {total} records  (gap={GAP_S}s)\n")
    p(f"IDs: {', '.join(sorted(TARGET_IDS))}\n")

    # Warm-up pause — let any in-flight server activity settle
    p("Waiting 5s for server to settle...")
    time.sleep(5)
    p("Starting eval...\n")

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
                # print deterministic field for visibility
                det = meta.get('deterministic', '')
                if det:
                    p(f"[{i+1:02}/{total}] {qa_id:8} {result.upper():7}  det={det!r}  {note[:75]}")
                else:
                    p(f"[{i+1:02}/{total}] {qa_id:8} {result.upper():7}  {note[:85]}")
            except Exception as e:
                result, note = 'fail', f'Error: {e}'
                p(f"[{i+1:02}/{total}] {qa_id:8} FAIL     {note}")

        outcomes[rec['id']] = (qa_id, result, note)

        if i < total - 1:
            time.sleep(GAP_S)

    # ── write back ────────────────────────────────────────────────────────────
    if not DRY_RUN:
        p(f"\nWriting {len(outcomes)} results to Airtable...")
        for rec_id, (qa_id, result, note) in outcomes.items():
            patch_record(rec_id, {
                'LAST_EVAL_RESULT': result,
                'LAST_EVAL_DATE':   TODAY,
                'NOTES':            note,
            })
            time.sleep(0.2)
        p("Write-back complete.")
    else:
        p("\n[DRY RUN — no write-back]")

    # ── summary ───────────────────────────────────────────────────────────────
    by_result = {'pass': [], 'partial': [], 'fail': []}
    for _, (qa_id, result, note) in outcomes.items():
        by_result[result].append((qa_id, note))

    p(f"\n{'='*60}")
    p(f"TARGETED EVAL  {TODAY}  ({total} records)")
    p(f"{'='*60}")
    p(f"  PASS    {len(by_result['pass']):2} / {total}")
    p(f"  PARTIAL {len(by_result['partial']):2} / {total}")
    p(f"  FAIL    {len(by_result['fail']):2} / {total}")

    if by_result['fail']:
        p(f"\nFAILS:")
        for qa_id, note in sorted(by_result['fail']):
            p(f"  {qa_id}  {note[:88]}")
    if by_result['partial']:
        p(f"\nPARTIALS:")
        for qa_id, note in sorted(by_result['partial']):
            p(f"  {qa_id}  {note[:88]}")


if __name__ == '__main__':
    main()
