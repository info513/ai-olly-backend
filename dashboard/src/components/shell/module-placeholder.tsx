"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Hammer, type LucideIcon } from "lucide-react";
import { NAV_ITEMS } from "./nav-config";
import { Button } from "@/components/ui/button";

/** Warm "coming soon" empty state for modules built in later sprints (UX Bible §15). */
export function ModulePlaceholder({ slug }: { slug: string[] }) {
  const key = slug[0] ?? "home";
  const nav = NAV_ITEMS.find((n) => n.href === `/${key}`);
  const Icon: LucideIcon = nav?.icon ?? Hammer;
  const label = nav?.label ?? key.charAt(0).toUpperCase() + key.slice(1);
  const sub = slug.slice(1).join(" / ");

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
        <h1 className="font-display text-2xl text-ink-primary">
          {label}
          {sub && <span className="text-ink-tertiary"> · {sub}</span>}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-ink-secondary">
          This module arrives in a later sprint. Sprint&nbsp;1 ships the shell — navigation, search,
          command palette, notifications and Home — so the experience can be validated before the
          modules are built on top of it.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button asChild variant="secondary">
            <Link href="/home">
              <ArrowLeft className="h-4 w-4" /> Back to Home
            </Link>
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
