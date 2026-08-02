"use client";

import * as React from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AuthUser } from "@/lib/types";

/**
 * SupabaseAuthProvider — the real session layer (no mock). Restores the session
 * on load, subscribes to auth changes (including expiry / token-refresh failure
 * → SIGNED_OUT), and exposes sign-in / sign-out / password-reset. The anon key +
 * user JWT are all it holds; the service-role key is never present client-side.
 */
interface AuthContextValue {
  user: AuthUser | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = React.useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) window.localStorage.removeItem("aiolly.hotel");
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const signIn = React.useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    [supabase]
  );

  const signOut = React.useCallback(async () => {
    window.localStorage.removeItem("aiolly.hotel");
    await supabase.auth.signOut();
  }, [supabase]);

  const resetPassword = React.useCallback(
    async (email: string) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      });
      if (error) throw error;
    },
    [supabase]
  );

  const value: AuthContextValue = {
    user: session?.user ? { id: session.user.id, email: session.user.email ?? null } : null,
    session,
    loading,
    signIn,
    signOut,
    resetPassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
