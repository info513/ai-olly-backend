"use client";

import * as React from "react";
import { useHotel } from "./hotel-provider";
import { canAccessModule, effectiveRole, type Role } from "@/lib/permissions";

/**
 * PermissionProvider — derives the effective role (platform admins outrank a
 * per-hotel membership) and a `can(module)` helper the UI uses to SHOW/HIDE
 * modules. Purely presentational: real authorization is enforced by RLS.
 */
interface PermissionContextValue {
  role: Role | null;
  isPlatformAdmin: boolean;
  can: (moduleKey: string) => boolean;
  ready: boolean;
}

const PermissionContext = React.createContext<PermissionContextValue | null>(null);

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const { role, isPlatformAdmin, currentHotel, loading } = useHotel();
  const eff = effectiveRole(role, isPlatformAdmin);

  const value: PermissionContextValue = React.useMemo(
    () => ({
      role: eff,
      isPlatformAdmin,
      can: (moduleKey: string) => canAccessModule(eff, moduleKey),
      ready: !loading && (isPlatformAdmin || Boolean(currentHotel)),
    }),
    [eff, isPlatformAdmin, currentHotel, loading]
  );

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions() {
  const ctx = React.useContext(PermissionContext);
  if (!ctx) throw new Error("usePermissions must be used within <PermissionProvider>");
  return ctx;
}
