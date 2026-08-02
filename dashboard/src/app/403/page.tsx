"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";

export default function ForbiddenPage() {
  const { signOut } = useAuth();
  const router = useRouter();
  return (
    <main className="grid min-h-screen place-items-center bg-surface-base px-4">
      <div className="max-w-md text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-border-subtle bg-surface-raised text-danger">
          <ShieldAlert className="h-6 w-6" />
        </span>
        <h1 className="font-display text-2xl text-ink-primary">You don’t have access to this area</h1>
        <p className="mx-auto mt-2 max-w-sm text-[14px] text-ink-secondary">
          Your role at this hotel doesn’t include this module. If you think that’s a mistake, ask a
          hotel admin to update your access.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button asChild variant="primary"><Link href="/home">Back to Home</Link></Button>
          <Button variant="ghost" onClick={async () => { await signOut(); router.replace("/login"); }}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
