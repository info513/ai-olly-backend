"use client";

import * as React from "react";
import { Lock, ShieldCheck, UploadCloud, Save } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { usePermissions } from "@/providers/permission-provider";
import { useAiConfig, useUpsertAiConfig, usePublishAiConfig } from "@/data/ai-config";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { SectionLoader, ErrorState, PermissionDenied } from "@/components/content/states";
import { StatusPill } from "@/components/content/pills";
import { TextField, TextAreaField, NumberField, ToggleField, Field } from "@/components/content/fields";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AiConfig } from "@/data/ai-types";

/** Logic that is PROTECTED IN CODE and never editable here (Part 13). Shown so
 *  the boundary is explicit, not hidden. */
const PROTECTED = [
  "Emergency & safety routing",
  "Anti-hallucination guards",
  "Token & QR security",
  "Room-identity verification",
  "Authorization & tenant isolation",
  "Fallback / safe-handoff safety net",
];

export default function AiConfigurationPage() {
  const { currentHotel } = useHotel();
  const { role, isPlatformAdmin } = usePermissions();
  const configQ = useAiConfig(currentHotel?.id);
  const upsert = useUpsertAiConfig(currentHotel?.id);
  const publish = usePublishAiConfig(currentHotel?.id);

  const [form, setForm] = React.useState<Partial<AiConfig>>({});
  const [dirty, setDirty] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const mayEdit = isPlatformAdmin || role === "hotel_admin";
  React.useEffect(() => { if (configQ.data) { setForm(configQ.data); setDirty(false); } }, [configQ.data]);

  const set = (patch: Partial<AiConfig>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); setSaved(false); };
  const flags = (form.feature_flags ?? {}) as Record<string, unknown>;
  const boolFlags = Object.entries(flags).filter(([, v]) => typeof v === "boolean") as [string, boolean][];

  const save = async () => {
    setError(null);
    try {
      await upsert.mutateAsync({
        persona: form.persona ?? null, tone: form.tone ?? null, safe_handoff_text: form.safe_handoff_text ?? null,
        retrieval_limit: form.retrieval_limit ?? 8, feature_flags: form.feature_flags ?? null, response_formatting: form.response_formatting ?? null,
      });
      setDirty(false); setSaved(true);
    } catch (e) { setError(humanizeError(e)); }
  };

  const doPublish = async () => {
    if (!configQ.data?.id) return;
    setError(null);
    try { await publish.mutateAsync({ id: configQ.data.id }); }
    catch (e) { setError(humanizeError(e)); }
  };

  return (
    <div className="mx-auto max-w-[860px] p-6 pb-24">
      <PageHeader
        crumbs={[{ label: "AI", href: "/ai" }, { label: "Configuration" }]}
        title="Olly settings"
        subtitle="Facts and approved wording Olly uses."
        actions={configQ.data && <span className="flex items-center gap-2"><StatusPill status={configQ.data.status} />{mayEdit && <Button variant="primary" onClick={doPublish} loading={publish.isPending}><UploadCloud className="h-4 w-4" /> Publish</Button>}</span>}
      />

      {/* Permanent protected-logic notice */}
      <div className="mb-5 flex items-start gap-3 rounded-lg border border-brand-navySoft/40 bg-brand-navy/15 px-4 py-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-cream" />
        <div>
          <p className="text-[13px] font-medium text-brand-creamSoft">Logic is protected in code. Hotel facts and approved wording are editable here.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PROTECTED.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-base/60 px-2 py-0.5 text-[11px] text-ink-tertiary"><Lock className="h-3 w-3" /> {p}</span>
            ))}
          </div>
        </div>
      </div>

      {configQ.isError ? (
        <ErrorState error={configQ.error} onRetry={() => configQ.refetch()} />
      ) : configQ.isLoading ? (
        <SectionLoader rows={5} />
      ) : (
        <>
          {!mayEdit && <div className="mb-4"><PermissionDenied message="Your role can view the AI configuration but not change it." /></div>}
          <div className="space-y-4">
            <Card className="p-5">
              <h2 className="mb-4 text-[13px] font-semibold text-ink-primary">Persona & voice</h2>
              <div className="space-y-4">
                <TextField label="Display name" hint="what the assistant calls itself" value={(form.persona as any)?.name ?? ""} onChange={(v) => set({ persona: { ...(form.persona as any), name: v } })} disabled={!mayEdit} placeholder="Dioclea" />
                <TextField label="Tone" value={form.tone ?? ""} onChange={(v) => set({ tone: v })} disabled={!mayEdit} placeholder="warm and concise" />
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="mb-4 text-[13px] font-semibold text-ink-primary">Approved wording</h2>
              <TextAreaField label="Safe handoff message" hint="shown when routing a guest to your team" value={form.safe_handoff_text ?? ""} onChange={(v) => set({ safe_handoff_text: v })} disabled={!mayEdit} rows={2} placeholder="Let me connect you with our reception team." />
            </Card>

            <Card className="p-5">
              <h2 className="mb-4 text-[13px] font-semibold text-ink-primary">Retrieval</h2>
              <div className="max-w-[200px]">
                <NumberField label="Max articles per answer" hint="1–50" value={form.retrieval_limit ?? 8} onChange={(v) => set({ retrieval_limit: Math.max(1, Math.min(50, v ?? 8)) })} disabled={!mayEdit} />
              </div>
            </Card>

            {boolFlags.length > 0 && (
              <Card className="p-5">
                <h2 className="mb-1 text-[13px] font-semibold text-ink-primary">Feature flags</h2>
                <p className="mb-4 text-[12px] text-ink-tertiary">Approved, non-logic switches only.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {boolFlags.map(([k, v]) => (
                    <ToggleField key={k} label={k.replace(/_/g, " ")} checked={v} onChange={(nv) => set({ feature_flags: { ...flags, [k]: nv } })} disabled={!mayEdit} />
                  ))}
                </div>
              </Card>
            )}
          </div>

          {mayEdit && (
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border-subtle bg-surface-base/90 backdrop-blur-md">
              <div className="mx-auto flex max-w-[860px] items-center justify-between px-6 py-3">
                <span className="text-[12px] text-ink-tertiary">
                  {error ? <span className="text-danger">{error}</span> : dirty ? "Unsaved changes" : saved ? <span className="text-success">Saved — publish to apply</span> : "All changes saved"}
                </span>
                <Button variant="secondary" onClick={save} loading={upsert.isPending} disabled={!dirty}><Save className="h-4 w-4" /> Save</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
