"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { useHotel } from "@/providers/hotel-provider";
import { useGuests, useCreateGuest } from "@/data/guests";
import { useRoomsLite, useCreateStay } from "@/data/stays";
import { humanizeError } from "@/data/errors";
import { PageHeader } from "@/components/content/page-header";
import { Field } from "@/components/content/fields";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const toDate = (v: string) => (v ? new Date(v + "T14:00:00Z").toISOString() : null);

export default function NewStay() {
  const router = useRouter();
  const { currentHotel } = useHotel();
  const guestsQ = useGuests(currentHotel?.id);
  const roomsQ = useRoomsLite(currentHotel?.id);
  const createStay = useCreateStay(currentHotel?.id);
  const createGuest = useCreateGuest(currentHotel?.id);

  const [guestId, setGuestId] = React.useState("");
  const [newGuest, setNewGuest] = React.useState(false);
  const [gFirst, setGFirst] = React.useState("");
  const [gLast, setGLast] = React.useState("");
  const [gEmail, setGEmail] = React.useState("");
  const [roomId, setRoomId] = React.useState("");
  const [arrival, setArrival] = React.useState("");
  const [departure, setDeparture] = React.useState("");
  const [extRef, setExtRef] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      let gid: string | null = guestId || null;
      if (newGuest) {
        if (!gFirst.trim() && !gLast.trim()) { setError("Enter the new guest's name."); return; }
        gid = await createGuest.mutateAsync({ firstName: gFirst.trim() || null, lastName: gLast.trim() || null, email: gEmail.trim() || null });
      }
      const id = await createStay.mutateAsync({
        guestId: gid, roomId: roomId || null, arrivalAt: toDate(arrival), departureAt: toDate(departure),
        externalSource: extRef ? "manual" : null, externalId: extRef || null,
      });
      router.push(`/stays/${id}`);
    } catch (e) { setError(humanizeError(e)); }
  };

  const pending = createStay.isPending || createGuest.isPending;

  return (
    <div className="mx-auto max-w-[720px] p-6">
      <PageHeader crumbs={[{ label: "Stays", href: "/stays" }, { label: "New stay" }]} title="New stay" subtitle="Create a reservation. You can check the guest in from the stay page." backHref="/stays" />

      <Card className="p-5">
        <div className="space-y-4">
          {/* Guest */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Guest</label>
              <button onClick={() => setNewGuest((v) => !v)} className="flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-brand-cream"><UserPlus className="h-3.5 w-3.5" /> {newGuest ? "Pick existing" : "New guest"}</button>
            </div>
            {newGuest ? (
              <div className="grid grid-cols-2 gap-2">
                <Input value={gFirst} onChange={(e) => setGFirst(e.target.value)} placeholder="First name" />
                <Input value={gLast} onChange={(e) => setGLast(e.target.value)} placeholder="Last name" />
                <Input className="col-span-2" value={gEmail} onChange={(e) => setGEmail(e.target.value)} placeholder="Email (optional)" />
              </div>
            ) : (
              <select value={guestId} onChange={(e) => setGuestId(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">
                <option value="">No guest yet</option>
                {(guestsQ.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.displayName}</option>)}
              </select>
            )}
          </div>

          <Field label="Room">
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="h-9 w-full rounded-md border border-border-strong bg-surface-sunken px-2 text-sm text-ink-primary focus-visible:border-brand-goldDeep focus-visible:outline-none">
              <option value="">No room yet</option>
              {(roomsQ.data ?? []).map((r) => <option key={r.id} value={r.id}>Room {r.roomNumber}</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Arrival"><Input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} /></Field>
            <Field label="Departure"><Input type="date" value={departure} onChange={(e) => setDeparture(e.target.value)} /></Field>
          </div>

          <Field label="External reference" hint="optional booking id"><Input value={extRef} onChange={(e) => setExtRef(e.target.value)} placeholder="e.g. BK-10293" /></Field>

          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => router.push("/stays")}>Cancel</Button><Button variant="primary" onClick={submit} loading={pending}>Create stay</Button></div>
        </div>
      </Card>
    </div>
  );
}
