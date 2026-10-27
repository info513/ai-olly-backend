-- Guest PWA push routing: associate a push subscription with the ROOM it was created
-- in (QR is per-room), so a request status change for that room can notify the guest.
-- Additive, forward-only. endpoint already has a UNIQUE constraint (clean upsert).
alter table public.push_subscriptions add column if not exists room_id uuid references public.rooms(id) on delete set null;
create index if not exists push_subscriptions_room_idx on public.push_subscriptions (hotel_id, room_id) where room_id is not null and active;
