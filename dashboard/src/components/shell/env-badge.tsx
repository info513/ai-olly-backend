"use client";

import { useHotel } from "@/providers/hotel-provider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Environment badge (UX Bible: Dev/Prod must be unmistakable). In Sprint 1 the
 * environment comes from the mocked hotel; production data is never touched.
 */
export function EnvBadge({ className }: { className?: string }) {
  const { currentHotel } = useHotel();
  const env = currentHotel?.environment ?? "dev";
  const isProd = env === "prod";
  return (
    <Badge
      tone={isProd ? "danger" : "warning"}
      dot
      className={cn("uppercase tracking-wide", className)}
      title={isProd ? "Production data — changes reach guests" : "Development data — safe to explore"}
    >
      {isProd ? "Prod" : "Dev"}
    </Badge>
  );
}
