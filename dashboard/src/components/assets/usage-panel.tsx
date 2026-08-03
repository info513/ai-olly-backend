"use client";

import * as React from "react";
import { Link2, Plus, X, Lock } from "lucide-react";
import { useAssetUsages, useAttachUsage, useDetachUsage } from "@/data/asset-usage";
import { humanizeError } from "@/data/errors";
import { SectionLoader } from "@/components/content/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AssetUsage } from "@/data/asset-types";

const ENTITY_TYPES = ["room", "hotel", "room_type", "poi", "route", "whisper", "service", "newsletter"];
const ROLES = ["hero", "card", "logo", "cover", "header", "gallery", "thumbnail"];

/**
 * "Where used?" (Part 7). Lists usages and lets authorized users attach/detach.
 * The DB scope trigger blocks cross-hotel attachment; consent signature/pdf
 * usages are historical evidence and are shown read-only here (never detachable
 * from this panel).
 */
export function UsagePanel({ assetId, hotelId, canManage, isPrivate }: { assetId: string; hotelId?: string; canManage: boolean; isPrivate: boolean }) {
  const q = useAssetUsages(assetId);
  const attach = useAttachUsage(hotelId);
  const detach = useDetachUsage(hotelId);
  const [open, setOpen] = React.useState(false);
  const [entityType, setEntityType] = React.useState("room");
  const [entityId, setEntityId] = React.useState("");
  const [role, setRole] = React.useState("hero");
  const [error, setError] = React.useState<string | null>(null);

  const run = async (p: Promise<unknown>) => { setError(null); try { await p; } catch (e) { setError(humanizeError(e)); } };
  const doAttach = async () => {
    if (!entityId.trim()) { setError("Enter the entity id to attach to."); return; }
    await run(attach.mutateAsync({ assetId, entityType, entityId: entityId.trim(), usageRole: role }).then(() => { setOpen(false); setEntityId(""); }));
  };

  const usages = q.data ?? [];
  const isConsentUsage = (u: AssetUsage) => u.entityType === "consent";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary"><Link2 className="h-3.5 w-3.5" /> Where used ({usages.length})</span>
        {canManage && !isPrivate && <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-brand-cream"><Plus className="h-3.5 w-3.5" /> Attach</button>}
      </div>

      {q.isLoading ? <SectionLoader rows={1} /> : usages.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-subtle px-3 py-4 text-center text-[13px] text-ink-tertiary">Not used anywhere yet.</p>
      ) : (
        <div className="space-y-1.5">
          {usages.map((u) => (
            <div key={`${u.entityType}-${u.entityId}-${u.usageRole}`} className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-base px-3 py-2 text-[13px]">
              <span className="font-medium capitalize text-ink-primary">{u.entityType.replace(/_/g, " ")}</span>
              <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[11px] text-ink-tertiary">{u.usageRole}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-tertiary">{u.entityId.slice(0, 8)}…</span>
              {isConsentUsage(u) ? (
                <span className="flex items-center gap-1 text-[11px] text-ink-tertiary"><Lock className="h-3 w-3" /> evidence</span>
              ) : canManage && !isPrivate ? (
                <button onClick={() => run(detach.mutateAsync({ assetId, entityType: u.entityType, entityId: u.entityId, usageRole: u.usageRole }))} className="rounded p-0.5 text-ink-tertiary hover:text-danger" title="Detach"><X className="h-3.5 w-3.5" /></button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {open && canManage && (
        <div className="mt-3 rounded-md border border-border-subtle bg-surface-base p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="h-8 rounded-md border border-border-strong bg-surface-sunken px-2 text-[12px] text-ink-primary focus-visible:outline-none">{ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="h-8 rounded-md border border-border-strong bg-surface-sunken px-2 text-[12px] text-ink-primary focus-visible:outline-none">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <Input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="entity id (uuid)" className="h-8 font-mono text-[12px]" />
          </div>
          <p className="mt-1.5 text-[11px] text-ink-tertiary">Synthetic wiring only this sprint — guest-facing content wiring is unchanged.</p>
          {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
          <div className="mt-2 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button><Button variant="secondary" size="sm" onClick={doAttach} loading={attach.isPending}>Attach</Button></div>
        </div>
      )}
      {error && !open && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
