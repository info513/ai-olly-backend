"use client";

// ============================================================================
// /settings/integrations — PMS (Rentlio) connection admin. platform_admin OR
// hotel_admin only (reception/editor/marketing denied). Every action calls an
// isolated /api/pms/* route that holds all credentials server-side — the browser
// never sees an API key, webhook token, or guest PII. R2 uses a SYNTHETIC adapter
// (no real hotel data); R3 swaps in the real Rentlio key + property id.
// ============================================================================

import * as React from "react";
import { PlugZap, ShieldCheck, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Link2 } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type View = any;

async function authedFetch(path: string, init?: RequestInit) {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token ?? "";
  const res = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), "content-type": "application/json", authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

const STATUS_STYLE: Record<string, string> = {
  healthy: "bg-emerald-500/10 text-emerald-600", needs_mapping: "bg-amber-500/10 text-amber-600",
  syncing: "bg-blue-500/10 text-blue-600", degraded: "bg-amber-500/10 text-amber-600",
  error: "bg-red-500/10 text-red-600", disconnected: "bg-surface-overlay text-ink-tertiary",
};

export default function IntegrationsPage() {
  const { currentHotel, role, isPlatformAdmin } = useHotel();
  const hotelId = currentHotel?.id ?? "";
  const canAdmin = isPlatformAdmin || role === "hotel_admin";
  const [view, setView] = React.useState<View | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<any | null>(null);

  const load = React.useCallback(() => {
    if (!hotelId) return;
    authedFetch(`/api/pms/integration?hotelId=${hotelId}`).then((v) => { setView(v); setError(null); }).catch((e) => setError(e.message));
  }, [hotelId]);
  React.useEffect(() => { if (canAdmin) load(); }, [canAdmin, load]);

  if (!canAdmin) {
    return (
      <div className="mx-auto max-w-lg py-24 text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-ink-tertiary" />
        <h1 className="mt-4 text-lg font-semibold text-ink-primary">Hotel admins only</h1>
        <p className="mt-2 text-sm text-ink-tertiary">Connecting a property-management system is restricted to hotel administrators.</p>
      </div>
    );
  }

  const act = async (key: string, fn: () => Promise<any>) => { setBusy(key); setError(null); try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(null); } };
  const connect = () => act("connect", async () => { const v = await authedFetch("/api/pms/integration", { method: "POST", body: JSON.stringify({ hotelId }) }); setView(v); });
  const setMapping = (externalId: string, roomId: string) =>
    act(`map:${externalId}`, async () => { await authedFetch("/api/pms/mappings", { method: "POST", body: JSON.stringify({ hotelId, externalId, roomId: roomId || null }) }); load(); });
  const runPreview = () => act("preview", async () => { setPreview(await authedFetch("/api/pms/sync-preview", { method: "POST", body: JSON.stringify({ hotelId }) })); });

  const integ = view?.integration;

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-primary"><PlugZap className="h-5 w-5" /> Property management (Rentlio)</h1>
          <p className="mt-1 text-sm text-ink-tertiary">Connect your PMS so reservations flow into stays automatically. Credentials stay on the server.</p>
        </div>
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600">DEV · synthetic data</span>
      </header>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600">{error}</div>}

      {!view ? (
        <p className="text-sm text-ink-tertiary">Loading…</p>
      ) : !view.connected ? (
        <Card title="Not connected" sub="no PMS linked yet">
          <p className="mb-4 text-[13px] text-ink-secondary">
            In development you can connect a <b>synthetic Rentlio property</b> — realistic units and reservations with no real guest data —
            to exercise mapping and sync. The real connection (API key + property ID) is added in the next phase.
          </p>
          <button onClick={connect} disabled={busy === "connect"} className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-medium text-brand-cream disabled:opacity-50">
            {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Connect synthetic property
          </button>
        </Card>
      ) : (
        <>
          {/* status */}
          <Card title="Connection" sub={integ.synthetic ? "synthetic (DEV)" : "live"}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
              <span className={`rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLE[integ.status] ?? ""}`}>{String(integ.status).replace("_", " ")}</span>
              <Kv k="Property ID" v={integ.externalPropertyId ?? "—"} />
              <Kv k="Credential" v={integ.hasCredential ? "configured ✓" : "—"} />
              <Kv k="Webhook token" v={integ.hasWebhookToken ? "configured ✓" : "—"} />
              <Kv k="Last sync" v={integ.lastSyncedAt ? new Date(integ.lastSyncedAt).toLocaleString() : "never"} />
              <Kv k="Units" v={`${view.counts.mapped}/${view.counts.units} mapped`} />
            </div>
            {integ.lastError && <p className="mt-3 flex items-center gap-2 text-[12px] text-red-600"><AlertTriangle className="h-3.5 w-3.5" />{integ.lastError}</p>}
          </Card>

          {/* unit mapping */}
          <Card title="Unit → room mapping" sub={view.counts.unmapped ? `${view.counts.unmapped} unmapped` : "all mapped ✓"}>
            <p className="mb-3 text-[12px] text-ink-tertiary">Each Rentlio unit must point to one of your rooms. Unmapped units are skipped safely (never attached to the wrong room).</p>
            <div className="divide-y divide-border-subtle">
              {view.mappings.map((m: any) => (
                <div key={m.external_id} className="flex items-center gap-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[13px] font-medium text-ink-primary">{m.external_name ?? m.external_id}</div>
                    <div className="text-[11px] text-ink-tertiary">{m.external_id}</div>
                  </div>
                  {!m.room_id && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">needs mapping</span>}
                  {m.room_id && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  <select value={m.room_id ?? ""} disabled={busy === `map:${m.external_id}`}
                    onChange={(e) => setMapping(m.external_id, e.target.value)}
                    className="w-40 rounded-md border border-border-subtle bg-surface-raised px-2 py-1.5 text-[12px] text-ink-primary">
                    <option value="">— unmapped —</option>
                    {view.rooms.map((r: any) => <option key={r.id} value={r.id}>Room {r.room_number}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </Card>

          {/* sync preview */}
          <Card title="Sync preview" sub="dry-run — no writes">
            <div className="flex items-center gap-3">
              <button onClick={runPreview} disabled={busy === "preview"} className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-ink-primary hover:bg-surface-hover disabled:opacity-50">
                {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Preview reservation import
              </button>
              {preview && (
                <div className="flex flex-wrap gap-3 text-[12px]">
                  <Chip label="would create" v={preview.wouldCreate} tone="emerald" />
                  <Chip label="would update" v={preview.wouldUpdate} tone="blue" />
                  <Chip label="needs mapping" v={preview.needsMapping} tone="amber" />
                  <Chip label="skipped" v={preview.wouldSkip} tone="gray" />
                  {preview.failed ? <Chip label="failed" v={preview.failed} tone="red" /> : null}
                </div>
              )}
            </div>
          </Card>

          {/* recent activity */}
          {view.events?.length ? (
            <Card title="Recent webhook events" sub={`${view.events.length}`}>
              <div className="space-y-1.5">
                {view.events.map((e: any) => (
                  <div key={e.provider_event_id} className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="font-medium text-ink-primary">{e.event_type}</span>
                    <span className="text-ink-tertiary">{e.status}{e.safe_error ? ` · ${e.safe_error}` : ""} · {new Date(e.received_at).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </>
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
const Kv = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <span className="inline-flex items-baseline gap-1"><span className="text-ink-tertiary">{k}:</span> <b className="font-medium text-ink-primary">{v}</b></span>
);
const TONE: Record<string, string> = { emerald: "bg-emerald-500/10 text-emerald-600", blue: "bg-blue-500/10 text-blue-600", amber: "bg-amber-500/10 text-amber-600", gray: "bg-surface-overlay text-ink-tertiary", red: "bg-red-500/10 text-red-600" };
const Chip = ({ label, v, tone }: { label: string; v: number; tone: string }) => (
  <span className={`rounded-md px-2 py-1 font-medium ${TONE[tone]}`}>{v} {label}</span>
);
