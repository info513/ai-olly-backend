"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Mode = "signin" | "reset";

export default function LoginPage() {
  const { signIn, resetPassword, session, loading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resetSent, setResetSent] = React.useState(false);

  React.useEffect(() => {
    if (!loading && session) router.replace("/home");
  }, [loading, session, router]);

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/home");
    } catch (err: any) {
      setError(err?.message?.includes("Invalid login") ? "Incorrect email or password." : err?.message ?? "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const onReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(email.trim());
      setResetSent(true);
    } catch (err: any) {
      setError(err?.message ?? "Could not send reset email.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative grid min-h-screen place-items-center bg-surface-base px-4">
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
          <h1 className="font-display text-2xl text-ink-primary">
            {mode === "signin" ? "Welcome to AI OLLY" : "Reset your password"}
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-tertiary">
            {mode === "signin" ? "The operating system for your hotel." : "We’ll email you a reset link."}
          </p>
        </div>

        {mode === "reset" && resetSent ? (
          <div className="rounded-xl border border-border-subtle bg-surface-raised p-6 text-center shadow-e1">
            <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
            <p className="mt-3 text-[14px] text-ink-primary">Check your inbox</p>
            <p className="mt-1 text-[13px] text-ink-tertiary">
              If an account exists for <span className="text-ink-secondary">{email}</span>, a reset link is on its way.
            </p>
            <Button variant="ghost" className="mt-4 w-full" onClick={() => { setMode("signin"); setResetSent(false); }}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <form
            onSubmit={mode === "signin" ? onSignIn : onReset}
            className="rounded-xl border border-border-subtle bg-surface-raised p-6 shadow-e1"
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">
                  Email
                </label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </div>

              {mode === "signin" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => { setMode("reset"); setError(null); }}
                      className="text-[11px] text-ink-tertiary transition-colors hover:text-brand-cream"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                </div>
              )}

              {error && <p className="text-[12px] text-danger">{error}</p>}

              <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
                {mode === "signin" ? (<>Sign in <ArrowRight className="h-4 w-4" /></>) : "Send reset link"}
              </Button>

              {mode === "reset" && (
                <Button type="button" variant="ghost" className="w-full" onClick={() => { setMode("signin"); setError(null); }}>
                  Back to sign in
                </Button>
              )}
            </div>
          </form>
        )}

        <p className="mt-4 text-center text-[11px] text-ink-tertiary">
          Connected to Supabase (dev). Access requires an active hotel membership.
        </p>
      </motion.div>
    </main>
  );
}
