"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const { signIn, session, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = React.useState("manager@demo-hotel.example");
  const [password, setPassword] = React.useState("demo");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!loading && session) router.replace("/home");
  }, [loading, session, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      router.replace("/home");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-surface-base px-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-brand-navy/40 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-brand-cream/5 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="relative w-full max-w-sm"
      >
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-cream font-display text-lg font-semibold text-brand-navyDeep">
            O
          </span>
          <h1 className="font-display text-2xl text-ink-primary">Welcome to AI OLLY</h1>
          <p className="mt-1.5 text-[13px] text-ink-tertiary">The operating system for your hotel.</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-xl border border-border-subtle bg-surface-raised p-6 shadow-e1"
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">
                Email
              </label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">
                Password
              </label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            {error && <p className="text-[12px] text-danger">{error}</p>}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
              Sign in <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </form>

        <p className="mt-4 text-center text-[11px] text-ink-tertiary">
          Sprint 1 preview — mock sign‑in, no real backend. Any credentials work.
        </p>
      </motion.div>
    </main>
  );
}
