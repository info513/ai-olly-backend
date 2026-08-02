import { cn } from "@/lib/utils";

/** Design System §15 — skeletons over spinners; shape-matched shimmer. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton rounded-md", className)} aria-hidden {...props} />;
}
