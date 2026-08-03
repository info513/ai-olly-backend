"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">{children}</label>
      {hint && <span className="text-[11px] text-ink-tertiary/70">{hint}</span>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      {children}
    </div>
  );
}

export function TextField({
  label, value, onChange, placeholder, disabled, hint,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} />
    </Field>
  );
}

export function TextAreaField({
  label, value, onChange, rows = 3, placeholder, disabled, hint,
}: { label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; disabled?: boolean; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full resize-y rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-ink-primary placeholder:text-ink-tertiary focus-visible:border-brand-goldDeep focus-visible:outline-none disabled:opacity-50"
      />
    </Field>
  );
}

export function NumberField({
  label, value, onChange, disabled, hint,
}: { label: string; value: number | null; onChange: (v: number | null) => void; disabled?: boolean; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        disabled={disabled}
      />
    </Field>
  );
}

export function ToggleField({
  label, checked, onChange, disabled, description,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; description?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border-subtle bg-surface-base px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-ink-primary">{label}</div>
        {description && <div className="text-[11px] text-ink-tertiary">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-brand-cream" : "bg-border-strong"
        )}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-surface-base transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

/** Segmented control. */
function Segment<T extends string>({
  value, options, onChange, disabled,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex rounded-md border border-border-strong bg-surface-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-50",
            value === o.value ? "bg-brand-navy text-brand-creamSoft" : "text-ink-tertiary hover:text-ink-secondary"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 3-state boolean override: Inherit / On / Off. `value` null = inherit; false is
 * preserved as an explicit choice (never treated as empty). Shows what "Inherit"
 * resolves to.
 */
export function ThreeStateBoolField({
  label, value, inherited, onChange, disabled,
}: { label: string; value: boolean | null; inherited: boolean | null; onChange: (v: boolean | null) => void; disabled?: boolean }) {
  const state: "inherit" | "on" | "off" = value === null || value === undefined ? "inherit" : value ? "on" : "off";
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-base px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-ink-primary">{label}</div>
        <div className="text-[11px] text-ink-tertiary">
          {state === "inherit" ? `Inheriting: ${inherited ? "On" : inherited === false ? "Off" : "—"}` : "Room-specific override"}
        </div>
      </div>
      <Segment
        value={state}
        disabled={disabled}
        onChange={(s) => onChange(s === "inherit" ? null : s === "on")}
        options={[
          { value: "inherit", label: "Inherit" },
          { value: "on", label: "On" },
          { value: "off", label: "Off" },
        ]}
      />
    </div>
  );
}

/**
 * Inherit-or-override text. `value` null/"" = inherit (shows the inherited value
 * as a preview); "Override" reveals an input pre-filled with the inherited value.
 */
export function InheritTextField({
  label, value, inherited, onChange, disabled, rows = 2,
}: { label: string; value: string | null; inherited: string | null; onChange: (v: string | null) => void; disabled?: boolean; rows?: number }) {
  const overriding = value !== null && value !== undefined;
  return (
    <div className="rounded-md border border-border-subtle bg-surface-base p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">{label}</label>
        {overriding ? (
          <button type="button" disabled={disabled} onClick={() => onChange(null)} className="text-[11px] text-ink-tertiary hover:text-brand-cream disabled:opacity-50">
            Use room-type default
          </button>
        ) : (
          <button type="button" disabled={disabled} onClick={() => onChange(inherited ?? "")} className="text-[11px] text-ink-tertiary hover:text-brand-cream disabled:opacity-50">
            Override for this room
          </button>
        )}
      </div>
      {overriding ? (
        <textarea
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          disabled={disabled}
          className="w-full resize-y rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none disabled:opacity-50"
        />
      ) : (
        <p className="rounded-md bg-surface-sunken px-3 py-2 text-[13px] text-ink-tertiary">
          {inherited?.trim() ? inherited : <span className="italic">Not set on the room type</span>}
          <span className="ml-2 text-[11px] uppercase tracking-wide text-ink-tertiary/60">inherited</span>
        </p>
      )}
    </div>
  );
}

export function TagsField({
  label, value, onChange, disabled, hint,
}: { label: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; hint?: string }) {
  const text = value.join("\n");
  return (
    <Field label={label} hint={hint ?? "one per line"}>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
        rows={3}
        disabled={disabled}
        className="w-full resize-y rounded-md border border-border-strong bg-surface-sunken px-3 py-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none disabled:opacity-50"
      />
    </Field>
  );
}
