"use client";

import * as React from "react";
import { PlayCircle, Sparkles, ArrowRight, CircleSlash } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useAnswerPreview, type AnswerPreviewResult } from "@/data/ai-preview";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { ResolvedKnowledgePanel } from "@/components/ai/resolved-knowledge-panel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const SAMPLES = ["What time is check-in?", "What's the wifi password?", "Is there parking?", "Who do I call in an emergency?"];

export default function AiPreviewPage() {
  const { currentHotel } = useHotel();
  const [question, setQuestion] = React.useState("");
  const [locale] = React.useState("en");
  const live = useAnswerPreview();
  const preview = useAnswerPreview();
  const [asked, setAsked] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const ask = async (qArg?: string) => {
    const q = (qArg ?? question).trim();
    if (!q || !currentHotel?.id) return;
    setError(null); setAsked(q);
    try {
      await Promise.all([
        live.mutateAsync({ hotelId: currentHotel.id, locale, question: q, mode: "live" }),
        preview.mutateAsync({ hotelId: currentHotel.id, locale, question: q, mode: "preview" }),
      ]);
    } catch (e) { setError(humanizeError(e)); }
  };

  const pending = live.isPending || preview.isPending;

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <PageHeader
        crumbs={[{ label: "Olly", href: "/ai" }, { label: "Try Olly" }]}
        title="Try Olly"
        subtitle="Ask a question and see exactly what Olly would answer — live vs your unpublished drafts. This never contacts the real guest assistant."
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[280px] flex-1">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Guest question</label>
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What time is check-in?" onKeyDown={(e) => { if (e.key === "Enter") ask(); }} />
          </div>
          <Button variant="primary" onClick={() => ask()} loading={pending} disabled={!question.trim()}><PlayCircle className="h-4 w-4" /> Ask</Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button key={s} onClick={() => { setQuestion(s); ask(s); }} className="rounded-full border border-border-subtle px-2.5 py-1 text-[12px] text-ink-tertiary hover:border-border-strong hover:text-ink-secondary">{s}</button>
          ))}
        </div>
        {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
      </Card>

      {asked && (
        <div className="mt-4">
          <div className="mb-2 text-[12px] text-ink-tertiary">Answer to “<span className="text-ink-secondary">{asked}</span>”</div>
          <div className="grid gap-4 lg:grid-cols-2">
            <AnswerCard title="Live" subtitle="What guests get now" loading={live.isPending} result={live.data} />
            <AnswerCard title="Preview" subtitle="With your unpublished drafts" loading={preview.isPending} result={preview.data} accent />
          </div>
        </div>
      )}

      <div className="mt-8 border-t border-border-subtle pt-6">
        <ResolvedKnowledgePanel hotelId={currentHotel?.id} locale={locale} />
      </div>
    </div>
  );
}

function AnswerCard({ title, subtitle, loading, result, accent }: { title: string; subtitle: string; loading: boolean; result?: AnswerPreviewResult; accent?: boolean }) {
  return (
    <Card className={cn("p-5", accent && "border-brand-goldDeep/30")}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold text-ink-primary">{title}</div>
          <div className="text-[11px] text-ink-tertiary">{subtitle}</div>
        </div>
        {result && <KindBadge kind={result.kind} />}
      </div>
      {loading ? (
        <div className="h-16 animate-pulse rounded-md bg-surface-overlay" />
      ) : !result ? (
        <p className="text-[13px] text-ink-tertiary">—</p>
      ) : result.kind === "insufficient" ? (
        <div className="flex items-start gap-2 rounded-md border border-border-subtle bg-surface-sunken px-3 py-2.5 text-[13px] text-ink-secondary">
          <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" /> <span>No confident answer from published knowledge. The assistant would safely hand off to your team.</span>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2 rounded-md border border-brand-navySoft/40 bg-brand-navy/20 px-3 py-2.5 text-[14px] text-brand-creamSoft">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" /> <span>{result.answer}</span>
          </div>
          {result.sources.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-tertiary">
              <ArrowRight className="h-3.5 w-3.5" /> Source:
              {result.sources.map((s, i) => <span key={i} className="rounded bg-surface-overlay px-1.5 py-0.5 text-ink-secondary">{s.title}</span>)}
            </div>
          )}
        </>
      )}
      {result?.note && <p className="mt-3 text-[11px] italic text-ink-tertiary">{result.note}</p>}
    </Card>
  );
}

function KindBadge({ kind }: { kind: AnswerPreviewResult["kind"] }) {
  const map: Record<AnswerPreviewResult["kind"], { label: string; cls: string }> = {
    retrieval: { label: "Retrieval", cls: "bg-info-soft/50 text-info" },
    model: { label: "Model", cls: "bg-brand-navySoft/40 text-brand-creamSoft" },
    insufficient: { label: "Handoff", cls: "bg-warning-soft/50 text-warning" },
    deferred: { label: "Deferred", cls: "bg-surface-overlay text-ink-tertiary" },
  };
  const m = map[kind];
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", m.cls)}>{m.label}</span>;
}
