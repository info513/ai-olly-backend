"use client";

import { Badge } from "@/components/ui/badge";
import { ENVIRONMENT } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Environment badge — reflects the Supabase project the dashboard is connected to
 * (Dev/Prod, from NEXT_PUBLIC_ENVIRONMENT). Sprint 2 connects to aiolly-dev, so
 * this reads "Dev". Dev/Prod must always be unmistakable (UX Bible §18).
 */
export function EnvBadge({ className }: { className?: string }) {
  const isProd = ENVIRONMENT === "prod";
  return (
    <Badge
      tone={isProd ? "danger" : "warning"}
      dot
      className={cn("uppercase tracking-wide", className)}
      title={isProd ? "Production data — changes reach guests" : "Development environment — safe to explore"}
    >
      {isProd ? "Prod" : "Dev"}
    </Badge>
  );
}
