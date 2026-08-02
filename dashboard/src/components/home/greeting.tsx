"use client";

import * as React from "react";
import { useAuth } from "@/providers/auth-provider";
import { useHotel } from "@/providers/hotel-provider";

export function Greeting() {
  const { user } = useAuth();
  const { currentHotel } = useHotel();
  const [part, setPart] = React.useState("Hello");

  React.useEffect(() => {
    const h = new Date().getHours();
    setPart(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);

  const first = user?.name?.split(" ")[0] ?? "there";

  return (
    <div>
      <h1 className="font-display text-[28px] leading-tight text-ink-primary">
        {part}, {first}.
      </h1>
      <p className="mt-1 text-[14px] text-ink-secondary">
        Here’s what needs you at <span className="text-ink-primary">{currentHotel?.name ?? "your hotel"}</span> today.
      </p>
    </div>
  );
}
