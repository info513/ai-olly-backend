-- ============================================================================
-- AI OLLY Platform 2.0 — Migration Step 10: Reception Operations
-- ----------------------------------------------------------------------------
-- guest_requests (practical lifecycle), request_events (append-only history,
-- internal vs guest-visible), feedback, push_subscriptions (endpoint/keys are
-- SECRET — column-hidden, never audited). Internal notes never leak to the safe
-- guest view. RLS from row one. Realtime-ready (documented). aiolly-dev only.
-- Idempotent; rebuildable via `supabase db reset`.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname='request_priority') then
    create type public.request_priority as enum ('low','normal','high','urgent');
  end if;
  if not exists (select 1 from pg_type where typname='request_status') then
    create type public.request_status as enum ('new','acknowledged','in_progress','resolved','closed','cancelled');
  end if;
  if not exists (select 1 from pg_type where typname='request_event_type') then
    create type public.request_event_type as enum
      ('created','acknowledged','assigned','status_change','internal_note','guest_reply','resolved','reopened');
  end if;
  if not exists (select 1 from pg_type where typname='feedback_status') then
    create type public.feedback_status as enum ('new','reviewed','resolved');
  end if;
end $$;

-- ── guest_requests ───────────────────────────────────────────────────────────
create table if not exists public.guest_requests (
  id                     uuid primary key default gen_random_uuid(),
  hotel_id               uuid not null references public.hotels(id) on delete cascade,
  stay_id                uuid references public.stays(id) on delete set null,
  room_id                uuid references public.rooms(id) on delete set null,
  guest_id               uuid references public.guests(id) on delete set null,
  request_type           text not null,
  title                  text not null,
  description            text,
  priority               public.request_priority not null default 'normal',
  status                 public.request_status not null default 'new',
  assigned_to            uuid,
  source                 text,
  guest_visible_response text,                     -- safe to show the guest
  internal_notes         text,                     -- staff-only (never guest-facing)
  created_at             timestamptz not null default now(),
  acknowledged_at        timestamptz,
  resolved_at            timestamptz,
  closed_at              timestamptz,
  created_by             uuid,
  updated_by             uuid,
  updated_at             timestamptz not null default now()
);
create index if not exists guest_requests_hotel_idx  on public.guest_requests (hotel_id, status);
create index if not exists guest_requests_stay_idx   on public.guest_requests (stay_id);

-- ── request_events (append-only history) ─────────────────────────────────────
create table if not exists public.request_events (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.guest_requests(id) on delete cascade,
  hotel_id       uuid not null references public.hotels(id) on delete cascade,
  event_type     public.request_event_type not null,
  from_status    public.request_status,
  to_status      public.request_status,
  note           text,
  is_internal    boolean not null default false,   -- internal notes never reach guest view
  actor_user_id  uuid,
  created_at     timestamptz not null default now()
);
create index if not exists request_events_request_idx on public.request_events (request_id, created_at);

-- ── feedback ─────────────────────────────────────────────────────────────────
create table if not exists public.feedback (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null references public.hotels(id) on delete cascade,
  stay_id             uuid references public.stays(id) on delete set null,
  room_id             uuid references public.rooms(id) on delete set null,
  rating              smallint,
  category            text,
  message             text,
  follow_up_requested boolean not null default false,
  status              public.feedback_status not null default 'new',
  assigned_to         uuid,
  source              text,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz,
  updated_at          timestamptz not null default now(),
  constraint feedback_rating check (rating is null or rating between 1 and 5)
);
create index if not exists feedback_hotel_idx on public.feedback (hotel_id, status);

-- ── push_subscriptions (endpoint/keys SECRET) ────────────────────────────────
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references public.hotels(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,   -- staff (future: guest/stay assoc)
  stay_id      uuid references public.stays(id) on delete set null,
  endpoint     text not null,     -- SECRET
  p256dh       text,              -- SECRET
  auth_key     text,              -- SECRET
  user_agent   text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  constraint push_subscriptions_endpoint_unique unique (endpoint)
);
create index if not exists push_subscriptions_hotel_idx on public.push_subscriptions (hotel_id);
create index if not exists push_subscriptions_user_idx  on public.push_subscriptions (user_id);

create trigger trg_guest_requests_updated_at before update on public.guest_requests for each row execute function platform.set_updated_at();
create trigger trg_feedback_updated_at       before update on public.feedback       for each row execute function platform.set_updated_at();

-- append-only guard for request_events (block UPDATE; DELETE not granted)
create trigger trg_request_events_immutable before update on public.request_events
  for each row execute function platform.block_row_update();

-- ── Auto history: append request_events on request create/status change ──────
create or replace function platform.log_request_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a_uid uuid;
begin
  a_uid := auth.uid();
  if tg_op = 'INSERT' then
    insert into public.request_events (request_id, hotel_id, event_type, to_status, actor_user_id)
    values (new.id, new.hotel_id, 'created', new.status, a_uid);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.request_events (request_id, hotel_id, event_type, from_status, to_status, actor_user_id)
    values (new.id, new.hotel_id,
            case when new.status = 'resolved' then 'resolved'
                 when new.status = 'acknowledged' then 'acknowledged'
                 else 'status_change' end,
            old.status, new.status, a_uid);
  end if;
  return coalesce(new, old);
end; $$;
create trigger trg_guest_requests_history after insert or update on public.guest_requests
  for each row execute function platform.log_request_event();

-- ── Redacted audit ───────────────────────────────────────────────────────────
create or replace function platform.audit_guest_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op<>'DELETE' then to_jsonb(new) end; oj := case when tg_op<>'INSERT' then to_jsonb(old) end;
  insert into public.audit_log (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state)
  values (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'),(oj->>'hotel_id'))::uuid, 'guest_request', coalesce((nj->>'id'),(oj->>'id'))::uuid,
     case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete' else 'update' end::public.audit_action,
     case when oj is not null then jsonb_build_object('status',oj->>'status','priority',oj->>'priority','assigned_to',oj->>'assigned_to') end,
     case when nj is not null then jsonb_build_object('status',nj->>'status','priority',nj->>'priority','assigned_to',nj->>'assigned_to') end);
  return coalesce(new, old);
end; $$;
create trigger trg_guest_requests_audit after insert or update or delete on public.guest_requests
  for each row execute function platform.audit_guest_request();

create or replace function platform.audit_feedback()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op<>'DELETE' then to_jsonb(new) end; oj := case when tg_op<>'INSERT' then to_jsonb(old) end;
  insert into public.audit_log (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state)
  values (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'),(oj->>'hotel_id'))::uuid, 'feedback', coalesce((nj->>'id'),(oj->>'id'))::uuid,
     case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete' else 'update' end::public.audit_action,
     case when oj is not null then jsonb_build_object('status',oj->>'status','rating',oj->>'rating') end,
     case when nj is not null then jsonb_build_object('status',nj->>'status','rating',nj->>'rating') end);
  return coalesce(new, old);
end; $$;
create trigger trg_feedback_audit after insert or update or delete on public.feedback
  for each row execute function platform.audit_feedback();

-- push audit: revocation/active only — NEVER endpoint/keys
create or replace function platform.audit_push_subscription()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op<>'DELETE' then to_jsonb(new) end; oj := case when tg_op<>'INSERT' then to_jsonb(old) end;
  insert into public.audit_log (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, after_state, metadata)
  values (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'),(oj->>'hotel_id'))::uuid, 'push_subscription', coalesce((nj->>'id'),(oj->>'id'))::uuid,
     case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete'
          when (nj->>'revoked_at') is not null and (oj->>'revoked_at') is null then 'update' else 'update' end::public.audit_action,
     jsonb_build_object('active', nj->>'active', 'revoked', (nj->>'revoked_at') is not null),
     jsonb_build_object('note','push subscription — endpoint/keys redacted'));
  return coalesce(new, old);
end; $$;
create trigger trg_push_subscriptions_audit after insert or update or delete on public.push_subscriptions
  for each row execute function platform.audit_push_subscription();

-- ── Safe guest-facing view (NO internal_notes, NO assignment/internal fields) ─
create or replace view public.guest_request_public
with (security_invoker = true) as
select id, hotel_id, stay_id, room_id, request_type, title, status, priority,
       guest_visible_response, created_at, acknowledged_at, resolved_at, closed_at
from public.guest_requests;

-- ── RLS + GRANTS (fail-closed; REVOKE ALL then precise GRANT) ─────────────────
alter table public.guest_requests     enable row level security;
alter table public.request_events     enable row level security;
alter table public.feedback           enable row level security;
alter table public.push_subscriptions enable row level security;

revoke all on public.guest_requests, public.request_events, public.feedback, public.push_subscriptions
  from public, anon, authenticated, service_role;
revoke all on public.guest_request_public from public, anon, authenticated, service_role;

-- service_role (backend)
grant select, insert, update on public.guest_requests to service_role;
grant select, insert         on public.request_events to service_role;   -- append-only
grant select, insert, update on public.feedback       to service_role;
grant select, insert, update on public.push_subscriptions to service_role;  -- full incl. secrets

-- authenticated (RLS-gated). push: column-level SELECT EXCLUDING secrets.
grant select, insert, update on public.guest_requests to authenticated;
grant select, insert         on public.request_events to authenticated;
grant select, insert, update on public.feedback       to authenticated;
grant insert, update on public.push_subscriptions to authenticated;
grant select (id, hotel_id, user_id, stay_id, user_agent, active, created_at, last_used_at, revoked_at)
  on public.push_subscriptions to authenticated;   -- endpoint/p256dh/auth_key NOT selectable
grant select on public.guest_request_public to authenticated;

-- GUEST_REQUESTS: reception + hotel_admin manage; editor/marketing/read_only no operational write.
create policy guest_requests_select on public.guest_requests for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );
create policy guest_requests_ins on public.guest_requests for insert to authenticated
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );
create policy guest_requests_upd on public.guest_requests for update to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) )
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );

-- REQUEST_EVENTS: same operational audience; append-only.
create policy request_events_select on public.request_events for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );
create policy request_events_ins on public.request_events for insert to authenticated
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );

-- FEEDBACK: reception + hotel_admin (isolated per hotel).
create policy feedback_select on public.feedback for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );
create policy feedback_ins on public.feedback for insert to authenticated
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );
create policy feedback_upd on public.feedback for update to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) )
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) );

-- PUSH_SUBSCRIPTIONS: a user manages own; hotel_admin manages hotel's; secrets hidden by grant.
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using ( platform.is_platform_admin() or user_id = auth.uid()
          or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]) );
create policy push_subscriptions_ins on public.push_subscriptions for insert to authenticated
  with check ( platform.is_platform_admin() or user_id = auth.uid()
               or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]) );
create policy push_subscriptions_upd on public.push_subscriptions for update to authenticated
  using ( platform.is_platform_admin() or user_id = auth.uid()
          or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]) )
  with check ( platform.is_platform_admin() or user_id = auth.uid()
               or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]) );
