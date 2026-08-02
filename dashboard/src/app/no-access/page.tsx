"use client";

import { useRouter } from "next/navigation";
import { DoorClosed } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";

/** Authenticated, but no active hotel membership (the "no tenant" case). */
export default function NoAccessPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  return (
    <main className="grid min-h-screen place-items-center bg-surface-base px-4">
      <div className="max-w-md text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-border-subtle bg-surface-raised text-warning">
          <DoorClosed className="h-6 w-6" />
        </span>
        <h1 className="font-display text-2xl text-ink-primary">No hotel access yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-[14px] text-ink-secondary">
          You’re signed in as <span className="text-ink-primary">{user?.email}</span>, but you don’t
          belong to any hotel yet. Ask a hotel admin to invite you, then sign in again.
        </p>
        <div className="mt-6 flex items-center justify-center">
          <Button variant="secondary" onClick={async () => { await signOut(); router.replace("/login"); }}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
