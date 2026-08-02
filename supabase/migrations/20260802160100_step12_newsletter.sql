-- ============================================================================
-- AI OLLY Platform 2.0 — Migration Step 12: Newsletter
-- ----------------------------------------------------------------------------
-- Subscribers (consent-linked), segments (static + validated rule structure —
-- NO arbitrary SQL), versioned templates, campaigns with immutable snapshots
-- after scheduling, append-only delivery events, idempotent webhook ingestion.
-- Brevo stays the delivery provider — NO real send, NO credentials here. RLS from
-- row one; PII/provider IDs protected; redacted audit. aiolly-dev only. Idempotent.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname='subscriber_status') then
    create type public.subscriber_status as enum ('pending','subscribed','unsubscribed','bounced','complained','suppressed');
  end if;
  if not exists (select 1 from pg_type where typname='campaign_status') then
    create type public.campaign_status as enum ('draft','preview','scheduled','sending','sent','cancelled','failed');
  end if;
  if not exists (select 1 from pg_type where typname='newsletter_event_type') then
    create type public.newsletter_event_type as enum ('sent','delivered','opened','clicked','bounced','unsubscribed','complained','deferred');
  end if;
  if not exists (select 1 from pg_type where typname='segment_type') then
    create type public.segment_type as enum ('static','rule');
  end if;
end $$;

-- Validated segment-rule structure (no arbitrary SQL). Shape:
--   { "match": "all|any", "conditions": [ {"field":"locale|country_code|source|status|tag","op":"eq|in","value":...}, ... ] }
create or replace function platform.is_valid_segment_rules(r jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select r is null or (
    jsonb_typeof(r) = 'object'
    and coalesce(r->>'match','all') in ('all','any')
    and jsonb_typeof(coalesce(r->'conditions','[]'::jsonb)) = 'array'
    and not exists (
      select 1 from jsonb_array_elements(coalesce(r->'conditions','[]'::jsonb)) e
      where jsonb_typeof(e) <> 'object'
         or (e->>'field') not in ('locale','country_code','source','status','tag')
         or (e->>'op') not in ('eq','in')
         or not (e ? 'value')
    )
  );
$$;

-- ── newsletter_subscribers ───────────────────────────────────────────────────
create table if not exists public.newsletter_subscribers (
  id               uuid primary key default gen_random_uuid(),
  hotel_id         uuid not null references public.hotels(id) on delete cascade,
  guest_id         uuid references public.guests(id) on delete set null,
  email            text not null,
  email_normalized text generated always as (lower(btrim(email))) stored,
  first_name       text,
  last_name        text,
  locale           text,
  country_code     text,
  status           public.subscriber_status not null default 'pending',
  source           text,
  subscribed_at    timestamptz,
  unsubscribed_at  timestamptz,
  consent_id       uuid references public.consents(id) on delete set null,
  brevo_contact_id text,
  tags             text[],
  metadata         jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint newsletter_subscribers_email_fmt check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint newsletter_subscribers_locale_fmt check (locale is null or locale ~ '^[a-z]{2}(-[a-z]{2})?$')
);
-- one subscriber row per (hotel, normalized email)
create unique index if not exists newsletter_subscribers_unique on public.newsletter_subscribers (hotel_id, email_normalized);
create index if not exists newsletter_subscribers_status_idx on public.newsletter_subscribers (hotel_id, status);

-- ── newsletter_segments (+ static membership) ────────────────────────────────
create table if not exists public.newsletter_segments (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  key         text not null,
  name        text not null,
  type        public.segment_type not null default 'static',
  rules       jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  constraint newsletter_segments_key_fmt check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint newsletter_segments_rules_valid check (platform.is_valid_segment_rules(rules)),
  constraint newsletter_segments_unique unique (hotel_id, key)
);
create table if not exists public.newsletter_segment_members (
  segment_id    uuid not null references public.newsletter_segments(id) on delete cascade,
  subscriber_id uuid not null references public.newsletter_subscribers(id) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (segment_id, subscriber_id)
);

-- ── newsletter_templates (versioned; platform default or hotel) ──────────────
create table if not exists public.newsletter_templates (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid references public.hotels(id) on delete cascade,   -- null = platform default
  key          text not null,
  name         text not null,
  subject      text not null,
  preview_text text,
  content      jsonb,                    -- structured blocks (validated)
  locale       text not null default 'en',
  status       public.content_status not null default 'draft',
  header_asset_id uuid references public.assets(id) on delete set null,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  constraint newsletter_templates_key_fmt check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint newsletter_templates_content_valid check (content is null or platform.is_valid_service_body(content))
);
create unique index if not exists newsletter_templates_key_platform on public.newsletter_templates (key, locale) where hotel_id is null;
create unique index if not exists newsletter_templates_key_hotel    on public.newsletter_templates (hotel_id, key, locale) where hotel_id is not null;

-- ── newsletter_campaigns (immutable snapshot after scheduling) ───────────────
create table if not exists public.newsletter_campaigns (
  id                    uuid primary key default gen_random_uuid(),
  hotel_id              uuid not null references public.hotels(id) on delete cascade,
  name                  text not null,
  template_id           uuid references public.newsletter_templates(id) on delete set null,
  segment_id            uuid references public.newsletter_segments(id) on delete set null,
  subject_snapshot      text,
  preview_text_snapshot text,
  content_snapshot      jsonb,
  segment_snapshot      jsonb,
  status                public.campaign_status not null default 'draft',
  scheduled_at          timestamptz,
  sent_at               timestamptz,
  brevo_campaign_id     text,
  recipient_total       integer not null default 0,
  delivered_total       integer not null default 0,
  opened_total          integer not null default 0,
  clicked_total         integer not null default 0,
  bounced_total         integer not null default 0,
  unsubscribed_total    integer not null default 0,
  created_by            uuid,
  approved_by           uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists newsletter_campaigns_hotel_idx on public.newsletter_campaigns (hotel_id, status);

-- ── recipients + append-only events + idempotent webhook events ──────────────
create table if not exists public.newsletter_campaign_recipients (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.newsletter_campaigns(id) on delete cascade,
  hotel_id          uuid not null references public.hotels(id) on delete cascade,
  subscriber_id     uuid references public.newsletter_subscribers(id) on delete set null,
  delivery_status   public.newsletter_event_type,
  brevo_message_id  text,
  sent_at           timestamptz,
  delivered_at      timestamptz,
  opened_at         timestamptz,
  clicked_at        timestamptz,
  bounced_at        timestamptz,
  unsubscribed_at   timestamptz,
  error_code        text,
  error_detail      text,
  created_at        timestamptz not null default now(),
  constraint ncr_unique unique (campaign_id, subscriber_id)
);
create index if not exists ncr_campaign_idx on public.newsletter_campaign_recipients (campaign_id);

create table if not exists public.newsletter_events (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  campaign_id   uuid references public.newsletter_campaigns(id) on delete cascade,
  recipient_id  uuid references public.newsletter_campaign_recipients(id) on delete set null,
  subscriber_id uuid references public.newsletter_subscribers(id) on delete set null,
  event_type    public.newsletter_event_type not null,
  occurred_at   timestamptz not null default now(),
  metadata      jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists newsletter_events_campaign_idx on public.newsletter_events (campaign_id, event_type);
create trigger trg_newsletter_events_immutable before update on public.newsletter_events
  for each row execute function platform.block_row_update();

create table if not exists public.newsletter_webhook_events (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid references public.hotels(id) on delete set null,
  provider          text not null default 'brevo',
  provider_event_id text not null,                 -- idempotency key
  event_type        text,
  payload           jsonb,                          -- redacted at ingestion
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),
  constraint nwe_idempotent unique (provider, provider_event_id)
);

create trigger trg_newsletter_subscribers_updated_at before update on public.newsletter_subscribers for each row execute function platform.set_updated_at();
create trigger trg_newsletter_segments_updated_at    before update on public.newsletter_segments    for each row execute function platform.set_updated_at();
create trigger trg_newsletter_templates_updated_at   before update on public.newsletter_templates   for each row execute function platform.set_updated_at();
create trigger trg_newsletter_campaigns_updated_at   before update on public.newsletter_campaigns   for each row execute function platform.set_updated_at();

-- ── Column / immutability protection ─────────────────────────────────────────
create or replace function platform.protect_campaign_snapshot()
returns trigger language plpgsql as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') then return new; end if;
  -- once scheduled/sending/sent, the frozen snapshot & targeting cannot change
  if old.status in ('scheduled','sending','sent') then
    new.subject_snapshot := old.subject_snapshot; new.preview_text_snapshot := old.preview_text_snapshot;
    new.content_snapshot := old.content_snapshot; new.segment_snapshot := old.segment_snapshot;
    new.template_id := old.template_id; new.segment_id := old.segment_id;
    new.scheduled_at := old.scheduled_at;
  end if;
  new.hotel_id := old.hotel_id; new.created_by := old.created_by;
  return new;
end; $$;
create trigger trg_newsletter_campaigns_protect before update on public.newsletter_campaigns
  for each row execute function platform.protect_campaign_snapshot();

create or replace function platform.protect_newsletter_template_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or platform.is_platform_admin() then return new; end if;
  new.hotel_id := old.hotel_id; new.key := old.key; new.created_by := old.created_by; new.published_at := old.published_at;
  if new.status='published' and old.status is distinct from 'published' then
    raise exception 'direct publish is not allowed; use public.publish_newsletter_template()' using errcode='42501';
  end if;
  return new;
end; $$;
create trigger trg_newsletter_templates_protect before update on public.newsletter_templates
  for each row execute function platform.protect_newsletter_template_columns();

-- ── Redacted audit (no email/PII, no provider payloads) ──────────────────────
create or replace function platform.audit_subscriber()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op<>'DELETE' then to_jsonb(new) end; oj := case when tg_op<>'INSERT' then to_jsonb(old) end;
  insert into public.audit_log (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state, metadata)
  values (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'),(oj->>'hotel_id'))::uuid, 'newsletter_subscriber', coalesce((nj->>'id'),(oj->>'id'))::uuid,
     case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete' else 'update' end::public.audit_action,
     case when oj is not null then jsonb_build_object('status',oj->>'status') end,
     case when nj is not null then jsonb_build_object('status',nj->>'status','has_consent',(nj->>'consent_id') is not null) end,
     jsonb_build_object('note','subscriber — email/PII redacted'));  -- never the email
  return coalesce(new, old);
end; $$;
create trigger trg_newsletter_subscribers_audit after insert or update or delete on public.newsletter_subscribers
  for each row execute function platform.audit_subscriber();

create or replace function platform.audit_campaign()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; act public.audit_action; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op<>'DELETE' then to_jsonb(new) end; oj := case when tg_op<>'INSERT' then to_jsonb(old) end;
  act := case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete'
              when (nj->>'status')='scheduled' and (oj->>'status') is distinct from 'scheduled' then 'publish'
              when (nj->>'status')='cancelled' and (oj->>'status') is distinct from 'cancelled' then 'archive'
              else 'update' end::public.audit_action;
  insert into public.audit_log (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state)
  values (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'),(oj->>'hotel_id'))::uuid, 'newsletter_campaign', coalesce((nj->>'id'),(oj->>'id'))::uuid, act,
     case when oj is not null then jsonb_build_object('status',oj->>'status','name',oj->>'name') end,
     case when nj is not null then jsonb_build_object('status',nj->>'status','name',nj->>'name','scheduled_at',nj->>'scheduled_at') end);
  return coalesce(new, old);
end; $$;
create trigger trg_newsletter_campaigns_audit after insert or update or delete on public.newsletter_campaigns
  for each row execute function platform.audit_campaign();

-- ── Publishing (template) + scheduling (campaign snapshot) + audience ────────
create or replace function public.publish_newsletter_template(p_template uuid, p_change_summary text default null)
returns public.content_versions language plpgsql volatile security definer set search_path = '' as $$
declare t public.newsletter_templates; vnum int; cv public.content_versions;
begin
  select * into t from public.newsletter_templates where id = p_template;
  if t.id is null then raise exception 'template % not found', p_template using errcode='P0002'; end if;
  if not ( platform.is_platform_admin()
           or (t.hotel_id is not null and platform.has_hotel_role(t.hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[])) ) then
    raise exception 'insufficient privilege to publish template %', p_template using errcode='42501';
  end if;
  select coalesce(max(version_number),0)+1 into vnum from public.content_versions where entity_type='newsletter_template' and entity_id=p_template;
  update public.newsletter_templates set status='published', published_at=now(), updated_by=auth.uid() where id=p_template returning * into t;
  insert into public.content_versions (entity_type, entity_id, version_number, status, snapshot, change_summary, hotel_id, published_at, created_by)
  values ('newsletter_template', p_template, vnum, 'published', to_jsonb(t), p_change_summary, t.hotel_id, now(), auth.uid())
  returning * into cv;
  return cv;
end; $$;

-- Freeze a campaign: snapshot template + segment, set status='scheduled'.
create or replace function public.schedule_campaign(p_campaign uuid, p_scheduled_at timestamptz)
returns public.newsletter_campaigns language plpgsql volatile security definer set search_path = '' as $$
declare c public.newsletter_campaigns; t public.newsletter_templates; s public.newsletter_segments;
begin
  select * into c from public.newsletter_campaigns where id = p_campaign;
  if c.id is null then raise exception 'campaign % not found', p_campaign using errcode='P0002'; end if;
  if not ( platform.is_platform_admin()
           or platform.has_hotel_role(c.hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]) ) then
    raise exception 'insufficient privilege to schedule campaign %', p_campaign using errcode='42501';
  end if;
  if c.status not in ('draft','preview') then raise exception 'campaign % is not schedulable (status %)', p_campaign, c.status using errcode='42501'; end if;
  select * into t from public.newsletter_templates where id = c.template_id;
  if t.id is null or t.status <> 'published' then raise exception 'campaign requires a published template' using errcode='42501'; end if;
  select * into s from public.newsletter_segments where id = c.segment_id;
  update public.newsletter_campaigns set
     subject_snapshot = t.subject, preview_text_snapshot = t.preview_text, content_snapshot = t.content,
     segment_snapshot = case when s.id is not null then to_jsonb(s) else null end,
     status = 'scheduled', scheduled_at = p_scheduled_at, updated_at = now()
   where id = p_campaign returning * into c;
  return c;
end; $$;

-- Resolve a campaign/segment audience — ALWAYS filters active consent + subscribed.
create or replace function public.resolve_newsletter_audience(p_segment uuid)
returns table (subscriber_id uuid, email text, locale text)
language plpgsql stable security definer set search_path = '' as $$
declare s public.newsletter_segments; loc text; ctry text;
begin
  select * into s from public.newsletter_segments where id = p_segment;
  if s.id is null then raise exception 'segment % not found', p_segment using errcode='P0002'; end if;
  if not ( platform.is_platform_admin()
           or platform.has_hotel_role(s.hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]) ) then
    raise exception 'insufficient privilege' using errcode='42501';
  end if;
  loc  := (select (e->>'value') from jsonb_array_elements(coalesce(s.rules->'conditions','[]'::jsonb)) e where e->>'field'='locale' and e->>'op'='eq' limit 1);
  ctry := (select (e->>'value') from jsonb_array_elements(coalesce(s.rules->'conditions','[]'::jsonb)) e where e->>'field'='country_code' and e->>'op'='eq' limit 1);
  return query
    select sub.id, sub.email, sub.locale
    from public.newsletter_subscribers sub
    where sub.hotel_id = s.hotel_id
      and sub.status = 'subscribed'
      and sub.consent_id is not null
      and exists (select 1 from public.consents co where co.id = sub.consent_id and co.status = 'granted')  -- active consent required
      and ( s.type = 'rule'
            or exists (select 1 from public.newsletter_segment_members m where m.segment_id = s.id and m.subscriber_id = sub.id) )
      and (loc  is null or sub.locale = loc)
      and (ctry is null or sub.country_code = ctry);
end; $$;

revoke all on function public.publish_newsletter_template(uuid,text), public.schedule_campaign(uuid,timestamptz), public.resolve_newsletter_audience(uuid) from public;
grant execute on function public.publish_newsletter_template(uuid,text), public.schedule_campaign(uuid,timestamptz), public.resolve_newsletter_audience(uuid) to authenticated, service_role;

-- ── RLS + GRANTS ─────────────────────────────────────────────────────────────
alter table public.newsletter_subscribers        enable row level security;
alter table public.newsletter_segments           enable row level security;
alter table public.newsletter_segment_members    enable row level security;
alter table public.newsletter_templates          enable row level security;
alter table public.newsletter_campaigns          enable row level security;
alter table public.newsletter_campaign_recipients enable row level security;
alter table public.newsletter_events             enable row level security;
alter table public.newsletter_webhook_events     enable row level security;

revoke all on public.newsletter_subscribers, public.newsletter_segments, public.newsletter_segment_members,
              public.newsletter_templates, public.newsletter_campaigns, public.newsletter_campaign_recipients,
              public.newsletter_events, public.newsletter_webhook_events
  from public, anon, authenticated, service_role;

-- service_role (future Brevo adapter/webhooks) — least privilege
grant select, insert, update on public.newsletter_subscribers        to service_role;
grant select, insert, update, delete on public.newsletter_segments   to service_role;
grant select, insert, update, delete on public.newsletter_segment_members to service_role;
grant select, insert, update on public.newsletter_templates          to service_role;
grant select, insert, update on public.newsletter_campaigns          to service_role;
grant select, insert, update on public.newsletter_campaign_recipients to service_role;
grant select, insert         on public.newsletter_events             to service_role;  -- append-only
grant select, insert         on public.newsletter_webhook_events     to service_role;  -- append-only ingest

-- authenticated (RLS-gated)
grant select, insert, update on public.newsletter_subscribers        to authenticated;
grant select, insert, update, delete on public.newsletter_segments   to authenticated;
grant select, insert, update, delete on public.newsletter_segment_members to authenticated;
grant select, insert, update on public.newsletter_templates          to authenticated;
grant select, insert, update on public.newsletter_campaigns          to authenticated;
grant select on public.newsletter_campaign_recipients to authenticated;
grant select on public.newsletter_events             to authenticated;
-- (webhook_events: NO authenticated grant — backend-only)

-- SUBSCRIBERS (PII): hotel_admin/marketing manage; reception may read consent status.
create policy nsub_select on public.newsletter_subscribers for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing','reception']::public.hotel_member_role[]) );
create policy nsub_write on public.newsletter_subscribers for insert to authenticated
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]) );
create policy nsub_upd on public.newsletter_subscribers for update to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]) )
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]) );

-- SEGMENTS + MEMBERS: hotel_admin/marketing manage
do $$ declare t text; begin
  foreach t in array array['newsletter_segments'] loop
    execute format($f$
      create policy %1$s_select on public.%1$I for select to authenticated
        using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]) );
      create policy %1$s_write on public.%1$I for all to authenticated
        using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]) )
        with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]) );
    $f$, t);
  end loop;
end $$;
create policy nsm_all on public.newsletter_segment_members for all to authenticated
  using ( exists (select 1 from public.newsletter_segments g where g.id = segment_id
            and (platform.is_platform_admin() or platform.has_hotel_role(g.hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]))) )
  with check ( exists (select 1 from public.newsletter_segments g where g.id = segment_id
            and (platform.is_platform_admin() or platform.has_hotel_role(g.hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]))) );

-- TEMPLATES: platform -> platform_admin; hotel -> hotel_admin/marketing; editor read-only (R1). Read by members.
create policy ntpl_select on public.newsletter_templates for select to authenticated
  using ( platform.is_platform_admin()
          or (hotel_id is not null and platform.has_hotel_membership(hotel_id))
          or (hotel_id is null and platform.has_any_membership()) );
create policy ntpl_ins on public.newsletter_templates for insert to authenticated
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]))) );
create policy ntpl_upd on public.newsletter_templates for update to authenticated
  using ( (hotel_id is null and platform.is_platform_admin())
          or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]))) )
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]))) );

-- CAMPAIGNS: hotel_admin/marketing manage; read_only reads summaries. reception cannot send (schedule fn excludes reception).
create policy ncmp_select on public.newsletter_campaigns for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_membership(hotel_id) );
create policy ncmp_ins on public.newsletter_campaigns for insert to authenticated
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]) );
create policy ncmp_upd on public.newsletter_campaigns for update to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]) )
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]) );

-- RECIPIENTS + EVENTS: read by hotel_admin/marketing; append-only events; webhook_events backend-only (no policy).
create policy ncr_select on public.newsletter_campaign_recipients for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]) );
create policy nev_select on public.newsletter_events for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[]) );
