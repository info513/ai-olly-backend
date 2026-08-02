"use client";

import * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "./query-provider";
import { AuthProvider } from "./auth-provider";
import { HotelProvider } from "./hotel-provider";
import { PermissionProvider } from "./permission-provider";
import { CommandProvider } from "./command-provider";

/**
 * Composition root. Order matters: Query → SupabaseAuth (session) →
 * HotelContext (profile + memberships + active hotel + role) → Permission
 * (effective role + capabilities) → Command → Tooltip.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <HotelProvider>
          <PermissionProvider>
            <CommandProvider>
              <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
            </CommandProvider>
          </PermissionProvider>
        </HotelProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
