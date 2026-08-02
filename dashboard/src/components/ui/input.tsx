import * as React from "react";
import { cn } from "@/lib/utils";

/** Design System §8 — quiet field, clear focus (global gold ring). */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-3 text-sm text-ink-primary",
        "placeholder:text-ink-tertiary focus-visible:border-brand-goldDeep focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
