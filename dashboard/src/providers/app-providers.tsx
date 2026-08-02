"use client";

import * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "./query-provider";
import { AuthProvider } from "./auth-provider";
import { HotelProvider } from "./hotel-provider";
import { CommandProvider } from "./command-provider";

/** Single composition root for all client providers. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <HotelProvider>
          <CommandProvider>
            <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          </CommandProvider>
        </HotelProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
