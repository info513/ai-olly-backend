import { cn } from "@/lib/utils";

/** Keyboard hint chip — used in the command bar and ⌘K affordances. */
export function Kbd({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong bg-surface-sunken px-1.5 font-sans text-[11px] font-medium text-ink-tertiary",
        className
      )}
    >
      {children}
    </kbd>
  );
}
