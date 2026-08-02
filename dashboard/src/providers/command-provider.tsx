"use client";

import * as React from "react";

interface CommandContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

const CommandContext = React.createContext<CommandContextValue | null>(null);

export function CommandProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const toggle = React.useCallback(() => setOpen((o) => !o), []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <CommandContext.Provider value={{ open, setOpen, toggle }}>{children}</CommandContext.Provider>
  );
}

export function useCommand() {
  const ctx = React.useContext(CommandContext);
  if (!ctx) throw new Error("useCommand must be used within <CommandProvider>");
  return ctx;
}
