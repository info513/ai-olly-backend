"use client";

// ============================================================================
// /platform/migration — Antique Split migration workspace (platform_admin, DEV-only).
// ----------------------------------------------------------------------------
// Every action calls an isolated server route (/api/migration/*) that holds the
// Airtable + service-role credentials. The browser never sees a credential, a room
// token, or a DB password. Hidden from every hotel role.
// ============================================================================

import * as React from "react";
import { AlertTriangle, DatabaseZap, Play, RefreshCw, ShieldCheck, GitCompareArrows, RotateCcw, Loader2 } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Status = any;

async function authedFetch(path: string, init?: RequestInit) {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token ?? "";
  const res = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), "content-type": "application/json", authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

interface Act { key: string; label: string; icon: typeof RefreshCw; note: string; danger?: boolean }
const ACTIONS: Act[] = [
  { key: "export", label: "Refresh source snapshot", icon: RefreshCw, note: "Read-only Airtable → local snapshot" },
  { key: "normalize", label: "Dry-run normalization", icon: Play, note: "raw → normalized (deterministic)" },
  { key: "dry-run", label: "Import dry-run", icon: DatabaseZap, note: "Transaction rolled back — no writes" },
  { key: "import", label: "Import to DEV", icon: DatabaseZap, note: "Idempotent upsert into aiolly-dev", danger: true },
  { key: "compare", label: "Run comparison", icon: GitCompareArrows, note: "Source ↔ Supabase parity" },
  { key: "reset", label: "Reset Antique DEV import", icon: RotateCcw, note: "Deletes imported content only", danger: true },
];

export default function MigrationWorkspace() {
  const { isPlatformAdmin } = useHotel();
  const [status, setStatus] = React.useState<Status | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [log, setLog] = React.useState<{ label: string; ok: boolean; text: string } | null>(null);

  const load = React.useCallback(() => {
    authedFetch("/api/migration/status").then(setStatus).catch((e) => setError(e.message));
  }, []);
  React.useEffect(() => { if (isPlatformAdmin) load(); }, [isPlatformAdmin, load]);

  if (!isPlatformAdmin) {
    return (
      <div className="mx-auto max-w-lg py-24 text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-ink-tertiary" />
        <h1 className="mt-4 text-lg font-semibold text-ink-primary">Platform admins only</h1>
        <p className="mt-2 text-sm text-ink-tertiary">The migration workspace is a development tool restricted to platform administrators.</p>
      </div>
    );
  }

  const run = async (action: string) => {
    if ((action === "import" || action === "reset") && !confirm(`Run "${action}" against aiolly-dev? DEV only — production is never touched.`)) return;
    setBusy(action); setLog(null); setError(null);
    try {
      const r = await authedFetch("/api/migration/run", { method: "POST", body: JSON.stringify({ action }) });
      setLog({ label: r.label, ok: r.ok, text: r.log });
      load();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  const snap = status?.snapshot, norm = status?.normalized, imp = status?.imported, cmp = status?.compare;

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-2">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Antique Split migration</h1>
          <p className="mt-1 text-sm text-ink-tertiary">Airtable → Supabase, DEV parity & cutover readiness.</p>
        </div>
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600">DEV only · no production cutover</span>
      </header>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600">{error}</div>}

      {/* counts */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Source snapshot" sub={snap?.exportedAt ? new Date(snap.exportedAt).toLocaleString() : "not exported"}>
          {snap ? <Kv rows={[["Content tables", snap.tables], ["PII tables", `${snap.piiCountOnly?.length ?? 0} (count-only)`]]} /> : <Empty />}
        </Card>
        <Card title="Normalized" sub={norm ? "deterministic" : "not run"}>
          {norm ? <Kv rows={[["Rooms", `${norm.rooms} (5 types)`], ["Services", norm.services], ["POIs / routes / events", `${norm.pois} / ${norm.routes} / ${norm.events}`], ["Price items", norm.price_items]]} /> : <Empty />}
        </Card>
        <Card title="Imported to DEV" sub={imp ? new Date(imp.importedAt).toLocaleString() : "not imported"}>
          {imp ? <Kv rows={[["Version", imp.importVersion], ["Rooms", imp.tables?.rooms ?? 0], ["Services", imp.tables?.hotel_services ?? 0], ["POIs", imp.tables?.destination_pois ?? 0]]} /> : <Empty />}
        </Card>
      </div>

      {/* compare */}
      <Card title="Provider comparison" sub={cmp?.status ?? "not run"}>
        {cmp?.domains ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(cmp.domains).map(([k, d]: any) => (
                <span key={k} className={`rounded-md px-2 py-1 text-[11px] font-medium ${d.status === "MATCH" ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}>
                  {k}: {d.source}/{d.supabase} {d.status === "MATCH" ? "✓" : "✕"}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-4 text-[12px] text-ink-secondary">
              <span>Rooms compared: <b className="text-ink-primary">{cmp.rooms}</b></span>
              <span>Tokens: <b className={cmp.tokenSafety === "TOKEN MATCH" ? "text-emerald-600" : "text-red-600"}>{cmp.tokenSafety ?? "—"}</b></span>
              {cmp.service && <span>Services: <b className="text-ink-primary">{cmp.service.MATCH} match · {cmp.service.TRANSFORMED} transformed · {cmp.service.MISSING} missing</b></span>}
            </div>
          </div>
        ) : <Empty />}
      </Card>

      {/* warnings */}
      {status?.warnings?.length ? (
        <Card title="Warnings & deferrals" sub={`${status.warnings.length}`}>
          <ul className="space-y-1.5">
            {status.warnings.map((w: string, i: number) => (
              <li key={i} className="flex gap-2 text-[13px] text-ink-secondary"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />{w}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* actions */}
      <Card title="Actions" sub="each runs server-side; credentials never reach the browser">
        <div className="grid gap-2 sm:grid-cols-2">
          {ACTIONS.map((a) => (
            <button key={a.key} onClick={() => run(a.key)} disabled={!!busy}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition disabled:opacity-50 ${a.danger ? "border-amber-500/30 hover:bg-amber-500/5" : "border-border-subtle hover:bg-surface-hover"}`}>
              {busy === a.key ? <Loader2 className="h-4 w-4 animate-spin text-ink-tertiary" /> : <a.icon className="h-4 w-4 text-ink-tertiary" />}
              <span className="flex-1"><span className="block text-sm font-medium text-ink-primary">{a.label}</span><span className="block text-[11px] text-ink-tertiary">{a.note}</span></span>
            </button>
          ))}
        </div>
      </Card>

      {log && (
        <Card title={`Last action — ${log.label}`} sub={log.ok ? "success" : "failed"}>
          <pre className={`max-h-72 overflow-auto rounded-md bg-surface-sunken p-3 text-[11px] leading-relaxed ${log.ok ? "text-ink-secondary" : "text-red-600"}`}>{log.text}</pre>
        </Card>
      )}
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface-raised p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink-primary">{title}</h2>
        {sub && <span className="text-[11px] text-ink-tertiary">{sub}</span>}
      </div>
      {children}
    </section>
  );
}
function Kv({ rows }: { rows: [string, React.ReactNode][] }) {
  return <dl className="space-y-1.5">{rows.map(([k, v]) => (
    <div key={k} className="flex items-baseline justify-between text-[13px]"><dt className="text-ink-tertiary">{k}</dt><dd className="font-medium text-ink-primary">{v}</dd></div>
  ))}</dl>;
}
const Empty = () => <p className="text-[13px] text-ink-tertiary">No data yet — run the step.</p>;
