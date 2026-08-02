"use client";

import { useRouter } from "next/navigation";
import { ConciergeBell, BookOpen, ImagePlus, Send, UserPlus, Sparkles, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

const ACTIONS: { label: string; icon: LucideIcon; href: string }[] = [
  { label: "New request", icon: ConciergeBell, href: "/reception" },
  { label: "New article", icon: BookOpen, href: "/content/knowledge" },
  { label: "Upload media", icon: ImagePlus, href: "/assets" },
  { label: "New campaign", icon: Send, href: "/newsletter" },
  { label: "Invite staff", icon: UserPlus, href: "/settings" },
  { label: "AI Quality", icon: Sparkles, href: "/ai" },
];

export function QuickActions() {
  const router = useRouter();
  return (
    <Card className="p-4">
      <div className="mb-3 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">
        Quick actions
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.label}
              onClick={() => router.push(a.href)}
              className="flex items-center gap-2.5 rounded-lg border border-border-subtle bg-surface-base px-3 py-2.5 text-left text-[13px] text-ink-secondary transition-colors hover:border-border-strong hover:bg-surface-overlay hover:text-ink-primary"
            >
              <Icon className="h-4 w-4 shrink-0 text-ink-tertiary" />
              <span className="truncate">{a.label}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
