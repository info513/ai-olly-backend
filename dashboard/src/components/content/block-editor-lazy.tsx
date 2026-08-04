"use client";

// Lazy BlockEditor (RC1 Cluster 3 · H4). The structured block editor is the
// heaviest component on the three editor routes (ai/knowledge, content/services,
// newsletter/templates). It is only needed once a user opens an editor, so we
// split it out of the initial route bundle. Same named export + props as the real
// component — drop-in replacement; a skeleton holds space to avoid layout shift.

import dynamic from "next/dynamic";

export const BlockEditor = dynamic(
  () => import("./block-editor").then((m) => m.BlockEditor),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-2" aria-hidden>
        <div className="flex gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-7 w-16 animate-pulse rounded-md bg-surface-overlay" />
          ))}
        </div>
        <div className="h-24 animate-pulse rounded-lg bg-surface-overlay" />
        <div className="h-16 animate-pulse rounded-lg bg-surface-overlay" />
      </div>
    ),
  }
);
