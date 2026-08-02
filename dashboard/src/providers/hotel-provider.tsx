"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { mockProvider } from "@/mock/provider";
import type { Hotel } from "@/mock/types";

interface HotelContextValue {
  hotels: Hotel[];
  currentHotel: Hotel | null;
  setHotelId: (id: string) => void;
  loading: boolean;
}

const HotelContext = React.createContext<HotelContextValue | null>(null);
const STORAGE_KEY = "aiolly.hotel";

export function HotelProvider({ children }: { children: React.ReactNode }) {
  const { data: hotels = [], isLoading } = useQuery({
    queryKey: ["hotels"],
    queryFn: () => mockProvider.listHotels(),
  });
  const [hotelId, setHotelIdState] = React.useState<string | null>(null);

  React.useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (stored) setHotelIdState(stored);
  }, []);

  React.useEffect(() => {
    if (!hotelId && hotels.length) setHotelIdState(hotels[0].id);
  }, [hotels, hotelId]);

  const setHotelId = React.useCallback((id: string) => {
    window.localStorage.setItem(STORAGE_KEY, id);
    setHotelIdState(id);
  }, []);

  const currentHotel = hotels.find((h) => h.id === hotelId) ?? hotels[0] ?? null;

  return (
    <HotelContext.Provider value={{ hotels, currentHotel, setHotelId, loading: isLoading }}>
      {children}
    </HotelContext.Provider>
  );
}

export function useHotel() {
  const ctx = React.useContext(HotelContext);
  if (!ctx) throw new Error("useHotel must be used within <HotelProvider>");
  return ctx;
}
