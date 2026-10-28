"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FileSignature, PenLine, ShieldCheck, Lock, CheckCircle2, ArrowLeft, DoorOpen } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useStays } from "@/data/stays";
import { useConsents, useConsentTemplates, signableTemplates, useSignConsent, ck } from "@/data/consents";
import { uploadPrivate } from "@/data/storage";
import { humanizeError } from "@/data/errors";
import { SignaturePad, SignatureClearButton, type SignaturePadHandle } from "@/components/reception/signature-pad";
import type { ConsentTemplate, StaySummary } from "@/data/reception-types";
import { Button } from "@/components/ui/button";

// ── Tiny guest-facing i18n (only the kiosk chrome; the consent BODY is the
//    template's own legal text). Falls back to English for any other locale. ──
type Lang = "hr" | "en";
const T: Record<Lang, Record<string, string>> = {
  hr: {
    title: "Privole za potpis", subtitle: "Odaberite svoje ime za potpis privole.",
    room: "Soba", arrival: "Dolazak", noPending: "Sve privole su potpisane. Hvala!",
    review: "Molimo pročitajte i potpišite", sign: "Potpišite ovdje", clear: "Obriši",
    accept: "Pročitao/la sam i prihvaćam gornji tekst privole.", needSign: "Potpišite u polju iznad.",
    confirm: "Potpiši i spremi", cancel: "Natrag", saving: "Spremam…", thanks: "Hvala! Privola je spremljena.",
    back: "Natrag na popis", exit: "Izađi iz kioska",
  },
  en: {
    title: "Consents to sign", subtitle: "Select your name to sign the consent.",
    room: "Room", arrival: "Arrival", noPending: "All consents are signed. Thank you!",
    review: "Please review and sign", sign: "Sign here", clear: "Clear",
    accept: "I have read and accept the consent text above.", needSign: "Please sign in the box above.",
    confirm: "Sign & save", cancel: "Back", saving: "Saving…", thanks: "Thank you! Your consent is saved.",
    back: "Back to list", exit: "Exit kiosk",
  },
};
const langOf = (locale?: string | null): Lang => (locale?.toLowerCase().startsWith("hr") ? "hr" : "en");

/** Auto-pick the consent template: prefer a privacy/GDPR key, then locale hr>en, then newest version. */
function autoTemplate(list: ConsentTemplate[], preferLocale?: string): ConsentTemplate | null {
  if (!list.length) return null;
  const keyRank = (k: string) => (/privol|privac|gdpr|data|personal/i.test(k) ? 0 : 1);
  const order = [preferLocale, "hr", "en"].filter(Boolean) as string[];
  const localeRank = (l: string) => { const i = order.indexOf(l); return i === -1 ? order.length + 1 : i; };
  return [...list].sort((a, b) => keyRank(a.key) - keyRank(b.key) || localeRank(a.locale) - localeRank(b.locale) || b.version - a.version)[0] ?? null;
}

export default function ConsentKiosk() {
  const router = useRouter();
  const qc = useQueryClient();
  const { currentHotel } = useHotel();
  const hotelId = currentHotel?.id;

  const staysQ = useStays(hotelId);
  const consentsQ = useConsents(hotelId);
  const templatesQ = useConsentTemplates(hotelId);
  const sign = useSignConsent();

  const [active, setActive] = React.useState<StaySummary | null>(null);
  const [done, setDone] = React.useState(false);

  const signable = signableTemplates(templatesQ.data ?? []);

  // Stays whose guest has no GRANTED consent yet (current + upcoming only).
  const pending = React.useMemo(() => {
    const granted = new Set((consentsQ.data ?? []).filter((c) => c.status === "granted").map((c) => c.guestId));
    const rank = (s: StaySummary) => (s.status === "checked_in" ? 0 : 1);
    return (staysQ.data ?? [])
      .filter((s) => s.guestId && (s.status === "checked_in" || s.status === "reserved") && !granted.has(s.guestId))
      .sort((a, b) => rank(a) - rank(b) || (b.arrivalAt ?? "").localeCompare(a.arrivalAt ?? ""));
  }, [staysQ.data, consentsQ.data]);

  const loading = staysQ.isLoading || consentsQ.isLoading || templatesQ.isLoading;

  const exit = () => { if (window.confirm("Exit kiosk and return to the dashboard?")) router.replace("/consent"); };

  // ── Signing screen ────────────────────────────────────────────────────────
  if (active) {
    return (
      <SignScreen
        stay={active}
        template={autoTemplate(signable, undefined)}
        allTemplates={signable}
        onCancel={() => setActive(null)}
        onSigned={async () => {
          await qc.invalidateQueries({ queryKey: ck.consents(hotelId) });
          setActive(null);
          setDone(true);
          setTimeout(() => setDone(false), 2600);
        }}
        signMutation={sign}
        hotelId={hotelId!}
      />
    );
  }

  // ── Worklist ─────────────────────────────────────────────────────────────
  const t = T.en; // list chrome stays in the hotel's working language (EN); per-guest language is applied on the signing screen
  return (
    <div className="mx-auto min-h-screen max-w-[900px] px-5 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-cream font-display text-lg font-semibold text-brand-navyDeep">O</span>
          <div>
            <div className="flex items-center gap-2 font-display text-[22px] text-ink-primary"><Lock className="h-4 w-4 text-ink-tertiary" /> {t.title}</div>
            <div className="text-[13px] text-ink-tertiary">{currentHotel?.name} · {t.subtitle}</div>
          </div>
        </div>
        <button onClick={exit} className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-3 py-2 text-[12px] text-ink-tertiary hover:text-ink-secondary">
          <DoorOpen className="h-4 w-4" /> {t.exit}
        </button>
      </div>

      {done && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[14px] text-emerald-300">
          <CheckCircle2 className="h-5 w-5" /> {T.en.thanks}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-overlay/40" />)}</div>
      ) : signable.length === 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-[14px] text-amber-200">
          No published consent template yet. Publish one in <span className="font-mono">Consent → Templates</span> first.
        </div>
      ) : pending.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-border-subtle bg-surface-raised/40 p-12 text-center">
          <ShieldCheck className="mb-3 h-10 w-10 text-emerald-400" />
          <div className="text-[16px] font-medium text-ink-primary">{t.noPending}</div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {pending.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s)}
              className="flex w-full items-center gap-4 rounded-xl border border-border-subtle bg-surface-raised/50 p-4 text-left transition-colors hover:border-brand-goldDeep active:scale-[0.99]"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-navy text-brand-cream"><FileSignature className="h-6 w-6" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px] font-medium text-ink-primary">{s.guestName ?? "Guest"}</div>
                <div className="text-[13px] text-ink-tertiary">
                  {s.roomNumber ? `${t.room} ${s.roomNumber}` : "—"}
                  {s.status === "checked_in" ? " · In house" : s.arrivalAt ? ` · ${t.arrival} ${new Date(s.arrivalAt).toLocaleDateString()}` : ""}
                </div>
              </div>
              <PenLine className="h-5 w-5 shrink-0 text-ink-tertiary" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Full-screen signing ──────────────────────────────────────────────────────
function SignScreen({
  stay, template, allTemplates, onCancel, onSigned, signMutation, hotelId,
}: {
  stay: StaySummary;
  template: ConsentTemplate | null;
  allTemplates: ConsentTemplate[];
  onCancel: () => void;
  onSigned: () => void | Promise<void>;
  signMutation: ReturnType<typeof useSignConsent>;
  hotelId: string;
}) {
  // Locale switch: other published versions of the SAME consent key.
  const variants = React.useMemo(
    () => (template ? allTemplates.filter((x) => x.key === template.key) : []),
    [allTemplates, template],
  );
  const [chosen, setChosen] = React.useState<ConsentTemplate | null>(template);
  React.useEffect(() => { setChosen(template); }, [template]);
  const tmpl = chosen ?? template;
  const lang = langOf(tmpl?.locale);
  const t = T[lang];

  const padRef = React.useRef<SignaturePadHandle>(null);
  const [hasInk, setHasInk] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const busy = signMutation.isPending || uploading;

  const submit = async () => {
    setError(null);
    if (!tmpl) { setError("No template."); return; }
    if (!stay.guestId) { setError("This stay has no linked guest."); return; }
    if (!hasInk || padRef.current?.isEmpty()) { setError(t.needSign); return; }
    if (!confirmed) { setError(t.accept); return; }
    try {
      setUploading(true);
      const blob = await padRef.current!.toBlob();
      if (!blob) { setUploading(false); setError(t.needSign); return; }
      const file = new File([blob], `signature-${Date.now()}.png`, { type: "image/png" });
      const up = await uploadPrivate({ file, assetType: "consent_signature", hotelId, displayName: `Signature — ${stay.guestName ?? "Guest"}` });
      setUploading(false);
      await signMutation.mutateAsync({
        templateId: tmpl.id,
        guestId: stay.guestId,
        stayId: stay.id,
        signedName: stay.guestName ?? "Guest",
        device: { source: "kiosk", signed_by: "guest", signed_with_signature: true, locale: tmpl.locale },
        signatureAssetId: up.assetId,
      });
      await onSigned();
    } catch (e) { setUploading(false); setError(humanizeError(e)); }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-[820px] flex-col px-5 py-6">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={onCancel} disabled={busy} className="inline-flex items-center gap-1.5 text-[14px] text-ink-tertiary hover:text-ink-secondary disabled:opacity-50">
          <ArrowLeft className="h-4 w-4" /> {t.back}
        </button>
        {variants.length > 1 && (
          <div className="flex gap-1.5">
            {Array.from(new Map(variants.map((v) => [v.locale, v])).values()).map((v) => (
              <button key={v.id} onClick={() => setChosen(v)} disabled={busy}
                className={`rounded-md px-2.5 py-1 text-[12px] uppercase ${tmpl?.locale === v.locale ? "bg-brand-cream text-brand-navy" : "border border-border-subtle text-ink-tertiary"}`}>
                {v.locale}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-1 font-display text-[22px] text-ink-primary">{t.review}</div>
      <div className="mb-4 text-[14px] text-ink-tertiary">
        {stay.guestName ?? "Guest"}{stay.roomNumber ? ` · ${t.room} ${stay.roomNumber}` : ""} · {tmpl?.title} <span className="font-mono">v{tmpl?.version}</span>
      </div>

      {/* Legal text — the exact approved wording that gets stored */}
      <div className="mb-5 max-h-[38vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-border-strong bg-surface-sunken px-4 py-3.5 text-[15px] leading-relaxed text-ink-secondary">
        {tmpl?.bodyText}
      </div>

      {/* Signature */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-[13px] font-semibold text-ink-secondary">{t.sign}</label>
          {hasInk && <SignatureClearButton onClick={() => { padRef.current?.clear(); setHasInk(false); }} />}
        </div>
        <div className="[&_canvas]:!h-56">
          <SignaturePad ref={padRef} onChange={setHasInk} disabled={busy} />
        </div>
      </div>

      <label className="mb-4 flex items-start gap-3 rounded-xl border border-border-subtle bg-surface-base p-4">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[color:var(--brand-cream)]" />
        <span className="text-[15px] text-ink-secondary">{t.accept}</span>
      </label>

      {error && <p className="mb-3 text-[13px] text-danger">{error}</p>}

      <div className="mt-auto flex justify-end gap-3 pt-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>{t.cancel}</Button>
        <Button variant="primary" onClick={submit} loading={busy} disabled={!hasInk || !confirmed} className="h-12 px-6 text-[15px]">
          <PenLine className="h-5 w-5" /> {uploading ? t.saving : t.confirm}
        </Button>
      </div>
    </div>
  );
}
