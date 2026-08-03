"use client";

import * as React from "react";
import { Plus, Trash2, Link2, AlertTriangle } from "lucide-react";
import { useAliases, useUpsertAlias, useDeleteAlias, useKnowledgeArticles } from "@/data/knowledge";
import { humanizeError } from "@/data/errors";
import { SectionLoader, ErrorState, EmptyState } from "@/components/content/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import type { KnowledgeAlias } from "@/data/ai-types";

const normalize = (s: string) => s.toLowerCase().trim();

/**
 * Aliases surface (Part 8): safe synonyms that route a phrase to an article.
 * NOT the 617-pattern system — exact normalized matching only, no wildcards.
 * Prevents duplicate normalized aliases within the same scope+locale and warns
 * on collisions. Hotel users manage hotel aliases; platform aliases are read-only
 * for them. Aliases never replace critical deterministic handlers.
 */
export function AliasesPanel({ hotelId, canManage }: { hotelId?: string; canManage: boolean }) {
  const aliasesQ = useAliases(hotelId);
  const articlesQ = useKnowledgeArticles(hotelId);
  const upsert = useUpsertAlias(hotelId);
  const del = useDeleteAlias(hotelId);

  const [text, setText] = React.useState("");
  const [locale, setLocale] = React.useState("en");
  const [articleId, setArticleId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const aliases = aliasesQ.data ?? [];
  const hotelAliases = aliases.filter((a) => a.hotel_id === hotelId);
  const platformAliases = aliases.filter((a) => a.hotel_id === null);

  // hotel articles are the only valid override/local targets for a hotel alias
  const targetArticles = (articlesQ.data ?? []).filter((a) => a.hotel_id === hotelId);

  const collision = React.useMemo(() => {
    const n = normalize(text);
    if (!n) return null;
    return hotelAliases.find((a) => a.normalized_alias === n && a.locale === locale) ?? null;
  }, [text, locale, hotelAliases]);

  const add = async () => {
    setError(null);
    if (!text.trim() || !articleId) { setError("Enter a phrase and pick a target article."); return; }
    if (collision) { setError("That phrase already routes to an article in this locale."); return; }
    try {
      await upsert.mutateAsync({ values: { alias_text: text.trim(), locale, article_id: articleId, active: true } });
      setText(""); setArticleId("");
    } catch (e) { setError(humanizeError(e)); }
  };

  return (
    <div className="space-y-5">
      <p className="rounded-md bg-surface-base px-3 py-2 text-[12px] text-ink-tertiary">
        Aliases map a guest phrase (“wifi password”) to an article. Matching is exact on the normalized phrase — no wildcards or broad patterns. Aliases never override safety / emergency handlers.
      </p>

      {canManage && (
        <Card className="p-4">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Add an alias</div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-[11px] text-ink-tertiary">Phrase</label>
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="wifi password" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-ink-tertiary">Locale</label>
              <select value={locale} onChange={(e) => setLocale(e.target.value)} className="h-9 rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">
                {["en", "hr", "de", "it", "fr", "es"].map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-[11px] text-ink-tertiary">Target article</label>
              <select value={articleId} onChange={(e) => setArticleId(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">
                <option value="">Choose…</option>
                {targetArticles.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </div>
            <Button variant="primary" onClick={add} loading={upsert.isPending}><Plus className="h-4 w-4" /> Add</Button>
          </div>
          {collision && <p className="mt-2 flex items-center gap-1.5 text-[12px] text-warning"><AlertTriangle className="h-3.5 w-3.5" /> “{normalize(text)}” already routes to “{collision.articleTitle ?? "an article"}” in {locale}.</p>}
          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
        </Card>
      )}

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Hotel aliases</div>
        {aliasesQ.isError ? (
          <ErrorState error={aliasesQ.error} onRetry={() => aliasesQ.refetch()} />
        ) : aliasesQ.isLoading ? (
          <SectionLoader rows={3} />
        ) : hotelAliases.length === 0 ? (
          <EmptyState icon={Link2} title="No hotel aliases yet" hint="Add phrases guests use so the AI routes them to the right answer." />
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="divide-y divide-border-subtle">
              {hotelAliases.map((al) => <AliasRow key={al.id} al={al} canManage={canManage} onDelete={() => del.mutate(al.id)} />)}
            </div>
          </Card>
        )}
      </div>

      {platformAliases.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Platform aliases (read-only)</div>
          <Card className="overflow-hidden p-0">
            <div className="divide-y divide-border-subtle">
              {platformAliases.map((al) => <AliasRow key={al.id} al={al} canManage={false} onDelete={() => {}} />)}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function AliasRow({ al, canManage, onDelete }: { al: KnowledgeAlias; canManage: boolean; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="font-mono text-[13px] text-ink-primary">{al.normalized_alias}</span>
      <Badge tone="neutral" className="uppercase">{al.locale}</Badge>
      <span className="text-ink-tertiary">→</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{al.articleTitle ?? al.intent_key ?? "—"}</span>
      {!al.active && <Badge tone="warning">Inactive</Badge>}
      {canManage && (
        <button onClick={onDelete} className="rounded p-1 text-ink-tertiary hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
      )}
    </div>
  );
}
