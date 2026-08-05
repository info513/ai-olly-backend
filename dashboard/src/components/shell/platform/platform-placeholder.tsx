"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Hammer } from "lucide-react";
import { platformModule } from "./platform-nav-config";
import { Button } from "@/components/ui/button";

/** "Coming in next phase" placeholder for Platform CMS modules built after Phase 1. */
export function PlatformPlaceholder({ moduleKey }: { moduleKey: string }) {
  const nav = platformModule(moduleKey);
  const Icon = nav?.icon ?? Hammer;
  const label = nav?.label ?? moduleKey.charAt(0).toUpperCase() + moduleKey.slice(1);

  return (
    <div className="grid min-h-full place-items-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
        className="max-w-md text-center"
      >
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-border-subtle bg-surface-raised text-brand-cream">
          <Icon className="h-6 w-6" />
        </span>
        <h1 className="font-display text-2xl text-ink-primary">{label}</h1>
        <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-ink-secondary">
          Coming in next phase. Phase&nbsp;1 ships the Platform CMS shell — navigation, destination
          context, search and Home — so the canonical destination modules can be built on top of it.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button asChild variant="secondary">
            <Link href="/platform"><ArrowLeft className="h-4 w-4" /> Platform Home</Link>
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
