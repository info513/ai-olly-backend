"use client";

import { useQuery } from "@tanstack/react-query";
import { mockProvider } from "@/mock/provider";

export function useNotifications() {
  return useQuery({ queryKey: ["notifications"], queryFn: () => mockProvider.listNotifications() });
}

export function useSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => mockProvider.search(query),
    enabled,
  });
}

export function useHomeSummary(hotelId: string | undefined) {
  return useQuery({
    queryKey: ["home", hotelId],
    queryFn: () => mockProvider.getHomeSummary(hotelId as string),
    enabled: Boolean(hotelId),
  });
}
