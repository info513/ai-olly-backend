"use client";

import { useQuery } from "@tanstack/react-query";
import { mockProvider } from "@/mock/provider";

/**
 * These read placeholder operational content, but they are now SCOPED to the
 * active hotel: the hotel id is part of every query key, so switching hotels
 * refetches for that context (Sprint 2 requirement). The content becomes real
 * Supabase data in a later sprint by swapping the mock provider body.
 */

export function useNotifications(hotelId: string | undefined) {
  return useQuery({
    queryKey: ["notifications", hotelId],
    queryFn: () => mockProvider.listNotifications(hotelId as string),
    enabled: Boolean(hotelId),
  });
}

export function useSearch(query: string, hotelId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["search", hotelId, query],
    queryFn: () => mockProvider.search(query, hotelId as string),
    enabled: enabled && Boolean(hotelId),
  });
}

export function useHomeSummary(hotelId: string | undefined) {
  return useQuery({
    queryKey: ["home", hotelId],
    queryFn: () => mockProvider.getHomeSummary(hotelId as string),
    enabled: Boolean(hotelId),
  });
}
