"use client";

import * as React from "react";
import { usePlatformDestinations, type PlatformDestination } from "@/data/platform";

const STORAGE_KEY = "aiolly.platform.destination";

interface PlatformContextValue {
  destinations: PlatformDestination[];
  currentDestination: PlatformDestination | null;
  setDestination: (id: string) => void;
  loading: boolean;
}

const PlatformContext = React.createContext<PlatformContextValue | null>(null);

/** Holds the active Platform CMS *destination* context (separate from the hotel switcher),
 *  persisted to localStorage. Shell only — no content editing. */
export function PlatformProvider({ children }: { children: React.ReactNode }) {
  const { data: destinations = [], isLoading } = usePlatformDestinations();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSelectedId(window.localStorage.getItem(STORAGE_KEY));
  }, []);

  const setDestination = React.useCallback((id: string) => {
    window.localStorage.setItem(STORAGE_KEY, id);
    setSelectedId(id);
  }, []);

  // Resolve current: stored selection if still valid, else the first destination.
  const currentDestination =
    destinations.find((d) => d.id === selectedId) ?? destinations[0] ?? null;

  const value: PlatformContextValue = {
    destinations,
    currentDestination,
    setDestination,
    loading: isLoading,
  };
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform() {
  const ctx = React.useContext(PlatformContext);
  if (!ctx) throw new Error("usePlatform must be used within PlatformProvider");
  return ctx;
}
