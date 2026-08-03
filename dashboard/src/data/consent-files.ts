"use client";

import { useQuery } from "@tanstack/react-query";
import { getSignedUrl } from "./storage";

/**
 * Private preview for consent signatures / documents. Requests an expiring signed
 * URL through the server route only when actually viewing — never stored in list
 * state, never a public URL. staleTime keeps it usable for a short window; the URL
 * itself carries the real expiry.
 */
export function useSignedPreview(assetId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ["assets", "signed", assetId],
    enabled: enabled && !!assetId,
    staleTime: 45_000,
    gcTime: 60_000,
    retry: false,
    queryFn: async () => {
      const r = await getSignedUrl(assetId as string);
      return r; // { url, expiresIn } | null
    },
  });
}
