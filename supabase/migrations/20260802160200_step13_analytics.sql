-- ============================================================================
-- AI OLLY Platform 2.0 — Migration Step 13: Analytics Foundation
-- ----------------------------------------------------------------------------
-- Tenant-safe DAILY aggregates (no PII, counts only): ai_quality_daily,
-- operations_daily, newsletter_daily, content_health_daily. Idempotent,
-- timezone-aware refresh functions (SECURITY DEFINER with internal authorization).
-- Formula/version stamped on every row (calc_version). RLS by role. aiolly-dev
-- only. Not a BI system; no cron/jobs here. Idempotent; rebuildable.
-- ============================================================================

-- Documented, versioned calculation identity. Bump on any formula change.
create or replace function platform.analytics_calc_version()
returns text language sql immutable set search_path = '' as $$ select 'v1'::text $$;

-- ── Aggregate tables (unique per hotel/day; counts only, no PII) ─────────────
create table if not exists public.ai_quality_daily (
  hotel_id               uuid not null references public.hotels(id) on delete cascade,
  day                    date not null,
  total_questions        integer not null default 0,
  deterministic_answers  integer not null default 0,
  model_answers          integer not null default 0,
  safe_handoffs          integer not null default 0,
  unanswered             integer not null default 0,
  avg_latency_ms         integer,
  prompt_tokens          bigint not null default 0,
  completion_tokens      bigint not null default 0,
  knowledge_articles_used integer not null default 0,
  coverage_estimate      numeric(5,4),          -- (total - safe_handoffs) / total  [0..1]
  calc_version           text not null,
  refreshed_at           timestamptz not null default now(),
  primary key (hotel_id, day)
);

create table if not exists public.operations_daily (
  hotel_id               uuid not null references public.hotels(id) on delete cascade,
  day                    date not null,
  requests_total         integer not null default 0,
  requests_resolved      integer not null default 0,
  requests_open          integer not null default 0,
  avg_ack_seconds        integer,
  avg_resolution_seconds integer,
  feedback_count         integer not null default 0,
  avg_rating             numeric(3,2),
  stays_arriving         integer not null default 0,
  consents_granted       integer not null default 0,
  calc_version           text not null,
  refreshed_at           timestamptz not null default now(),
  primary key (hotel_id, day)
);

create table if not exists public.newsletter_daily (
  hotel_id            uuid not null references public.hotels(id) on delete cascade,
  day                 date not null,
  subscribers_active  integer not null default 0,
  consent_active      integer not null default 0,
  sent                integer not null default 0,
  delivered           integer not null default 0,
  opened              integer not null default 0,
  clicked             integer not null default 0,
  bounced             integer not null default 0,
  unsubscribed        integer not null default 0,
  calc_version        text not null,
  refreshed_at        timestamptz not null default now(),
  primary key (hotel_id, day)
);

create table if not exists public.content_health_daily (
  hotel_id               uuid not null references public.hotels(id) on delete cascade,
  day                    date not null,
  published_count        integer not null default 0,
  draft_count            integer not null default 0,
  archived_count         integer not null default 0,
  expired_count          integer not null default 0,
  critical_pending       integer not null default 0,
  unresolved_unanswered  integer not null default 0,
  unused_assets          integer not null default 0,
  assets_missing_alt     integer not null default 0,
  assets_missing_rights  integer not null default 0,
  completeness_score     numeric(5,4),          -- published / (published+draft+expired+critical_pending)  [0..1]
  calc_version           text not null,
  refreshed_at           timestamptz not null default now(),
  primary key (hotel_id, day)
);

-- ── Refresh functions (SECURITY DEFINER; internal authz; tz-aware; idempotent) ─
create or replace function platform.assert_analytics_access(p_hotel uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not ( platform.is_platform_admin()
           or platform.has_hotel_role(p_hotel, array['hotel_admin','editor','reception','marketing','read_only']::public.hotel_member_role[]) ) then
    raise exception 'insufficient privilege for hotel analytics' using errcode='42501';
  end if;
end; $$;

create or replace function public.refresh_ai_quality_daily(p_hotel uuid, p_day date)
returns public.ai_quality_daily language plpgsql volatile security definer set search_path = '' as $$
declare tz text; row public.ai_quality_daily;
begin
  perform platform.assert_analytics_access(p_hotel);
  select timezone into tz from public.hotels where id = p_hotel;
  if tz is null then raise exception 'hotel % not found', p_hotel using errcode='P0002'; end if;
  insert into public.ai_quality_daily as t
    (hotel_id, day, total_questions, deterministic_answers, model_answers, safe_handoffs, unanswered,
     avg_latency_ms, prompt_tokens, completion_tokens, knowledge_articles_used, coverage_estimate, calc_version, refreshed_at)
  select p_hotel, p_day,
     count(*),
     count(*) filter (where l.deterministic_handler is not null),
     count(*) filter (where l.deterministic_handler is null and not l.handoff),
     count(*) filter (where l.handoff),
     (select count(*) from public.unanswered_questions uq where uq.hotel_id=p_hotel and (uq.last_seen_at at time zone tz)::date = p_day),
     avg(l.latency_ms)::int,
     coalesce(sum(l.prompt_tokens),0), coalesce(sum(l.completion_tokens),0),
     (select count(distinct kid) from public.ai_response_logs l2, unnest(coalesce(l2.knowledge_ids,'{}')) kid
        where l2.hotel_id=p_hotel and (l2.created_at at time zone tz)::date = p_day),
     case when count(*)>0 then round((count(*) - count(*) filter (where l.handoff))::numeric / count(*), 4) else null end,
     platform.analytics_calc_version(), now()
  from public.ai_response_logs l
  where l.hotel_id = p_hotel and (l.created_at at time zone tz)::date = p_day
  on conflict (hotel_id, day) do update set
     total_questions=excluded.total_questions, deterministic_answers=excluded.deterministic_answers,
     model_answers=excluded.model_answers, safe_handoffs=excluded.safe_handoffs, unanswered=excluded.unanswered,
     avg_latency_ms=excluded.avg_latency_ms, prompt_tokens=excluded.prompt_tokens, completion_tokens=excluded.completion_tokens,
     knowledge_articles_used=excluded.knowledge_articles_used, coverage_estimate=excluded.coverage_estimate,
     calc_version=excluded.calc_version, refreshed_at=now()
  returning * into row;
  return row;
end; $$;

create or replace function public.refresh_operations_daily(p_hotel uuid, p_day date)
returns public.operations_daily language plpgsql volatile security definer set search_path = '' as $$
declare tz text; row public.operations_daily;
begin
  perform platform.assert_analytics_access(p_hotel);
  select timezone into tz from public.hotels where id = p_hotel;
  if tz is null then raise exception 'hotel % not found', p_hotel using errcode='P0002'; end if;
  insert into public.operations_daily as t
    (hotel_id, day, requests_total, requests_resolved, requests_open, avg_ack_seconds, avg_resolution_seconds,
     feedback_count, avg_rating, stays_arriving, consents_granted, calc_version, refreshed_at)
  values (p_hotel, p_day,
     (select count(*) from public.guest_requests r where r.hotel_id=p_hotel and (r.created_at at time zone tz)::date=p_day),
     (select count(*) from public.guest_requests r where r.hotel_id=p_hotel and r.resolved_at is not null and (r.resolved_at at time zone tz)::date=p_day),
     (select count(*) from public.guest_requests r where r.hotel_id=p_hotel and r.status not in ('resolved','closed','cancelled') and (r.created_at at time zone tz)::date=p_day),
     (select avg(extract(epoch from (r.acknowledged_at - r.created_at)))::int from public.guest_requests r where r.hotel_id=p_hotel and r.acknowledged_at is not null and (r.created_at at time zone tz)::date=p_day),
     (select avg(extract(epoch from (r.resolved_at - r.created_at)))::int from public.guest_requests r where r.hotel_id=p_hotel and r.resolved_at is not null and (r.created_at at time zone tz)::date=p_day),
     (select count(*) from public.feedback f where f.hotel_id=p_hotel and (f.created_at at time zone tz)::date=p_day),
     (select round(avg(f.rating),2) from public.feedback f where f.hotel_id=p_hotel and f.rating is not null and (f.created_at at time zone tz)::date=p_day),
     (select count(*) from public.stays s where s.hotel_id=p_hotel and s.arrival_at is not null and (s.arrival_at at time zone tz)::date=p_day),
     (select count(*) from public.consents c where c.hotel_id=p_hotel and c.status='granted' and (c.signed_at at time zone tz)::date=p_day),
     platform.analytics_calc_version(), now())
  on conflict (hotel_id, day) do update set
     requests_total=excluded.requests_total, requests_resolved=excluded.requests_resolved, requests_open=excluded.requests_open,
     avg_ack_seconds=excluded.avg_ack_seconds, avg_resolution_seconds=excluded.avg_resolution_seconds,
     feedback_count=excluded.feedback_count, avg_rating=excluded.avg_rating, stays_arriving=excluded.stays_arriving,
     consents_granted=excluded.consents_granted, calc_version=excluded.calc_version, refreshed_at=now()
  returning * into row;
  return row;
end; $$;

create or replace function public.refresh_newsletter_daily(p_hotel uuid, p_day date)
returns public.newsletter_daily language plpgsql volatile security definer set search_path = '' as $$
declare tz text; row public.newsletter_daily;
begin
  perform platform.assert_analytics_access(p_hotel);
  select timezone into tz from public.hotels where id = p_hotel;
  if tz is null then raise exception 'hotel % not found', p_hotel using errcode='P0002'; end if;
  insert into public.newsletter_daily as t
    (hotel_id, day, subscribers_active, consent_active, sent, delivered, opened, clicked, bounced, unsubscribed, calc_version, refreshed_at)
  values (p_hotel, p_day,
     (select count(*) from public.newsletter_subscribers s where s.hotel_id=p_hotel and s.status='subscribed'),
     (select count(*) from public.newsletter_subscribers s where s.hotel_id=p_hotel and s.status='subscribed' and s.consent_id is not null
        and exists (select 1 from public.consents c where c.id=s.consent_id and c.status='granted')),
     (select count(*) from public.newsletter_events e where e.hotel_id=p_hotel and e.event_type='sent'      and (e.occurred_at at time zone tz)::date=p_day),
     (select count(*) from public.newsletter_events e where e.hotel_id=p_hotel and e.event_type='delivered' and (e.occurred_at at time zone tz)::date=p_day),
     (select count(*) from public.newsletter_events e where e.hotel_id=p_hotel and e.event_type='opened'    and (e.occurred_at at time zone tz)::date=p_day),
     (select count(*) from public.newsletter_events e where e.hotel_id=p_hotel and e.event_type='clicked'   and (e.occurred_at at time zone tz)::date=p_day),
     (select count(*) from public.newsletter_events e where e.hotel_id=p_hotel and e.event_type='bounced'   and (e.occurred_at at time zone tz)::date=p_day),
     (select count(*) from public.newsletter_events e where e.hotel_id=p_hotel and e.event_type='unsubscribed' and (e.occurred_at at time zone tz)::date=p_day),
     platform.analytics_calc_version(), now())
  on conflict (hotel_id, day) do update set
     subscribers_active=excluded.subscribers_active, consent_active=excluded.consent_active, sent=excluded.sent,
     delivered=excluded.delivered, opened=excluded.opened, clicked=excluded.clicked, bounced=excluded.bounced,
     unsubscribed=excluded.unsubscribed, calc_version=excluded.calc_version, refreshed_at=now()
  returning * into row;
  return row;
end; $$;

create or replace function public.refresh_content_health_daily(p_hotel uuid, p_day date)
returns public.content_health_daily language plpgsql volatile security definer set search_path = '' as $$
declare row public.content_health_daily; pub int; drf int; arc int; exp int; crit int;
begin
  perform platform.assert_analytics_access(p_hotel);
  if not exists (select 1 from public.hotels where id=p_hotel) then raise exception 'hotel % not found', p_hotel using errcode='P0002'; end if;
  select count(*) filter (where status='published'),
         count(*) filter (where status='draft'),
         count(*) filter (where status='archived'),
         count(*) filter (where status='published' and valid_to is not null and valid_to < now()),
         count(*) filter (where is_critical and status <> 'published')
    into pub, drf, arc, exp, crit
    from public.knowledge_articles where hotel_id = p_hotel;
  insert into public.content_health_daily as t
    (hotel_id, day, published_count, draft_count, archived_count, expired_count, critical_pending,
     unresolved_unanswered, unused_assets, assets_missing_alt, assets_missing_rights, completeness_score, calc_version, refreshed_at)
  values (p_hotel, p_day, pub, drf, arc, exp, crit,
     (select count(*) from public.unanswered_questions u where u.hotel_id=p_hotel and u.status='open'),
     (select count(*) from public.assets a where a.hotel_id=p_hotel and a.deleted_at is null
        and not exists (select 1 from public.asset_usages au where au.asset_id=a.id)),
     (select count(*) from public.assets a where a.hotel_id=p_hotel and a.deleted_at is null and a.status='ready' and a.alt_text is null),
     (select count(*) from public.assets a where a.hotel_id=p_hotel and a.deleted_at is null and a.rights_owner is null),
     case when (pub+drf+exp+crit) > 0 then round(pub::numeric / (pub+drf+exp+crit), 4) else null end,
     platform.analytics_calc_version(), now())
  on conflict (hotel_id, day) do update set
     published_count=excluded.published_count, draft_count=excluded.draft_count, archived_count=excluded.archived_count,
     expired_count=excluded.expired_count, critical_pending=excluded.critical_pending, unresolved_unanswered=excluded.unresolved_unanswered,
     unused_assets=excluded.unused_assets, assets_missing_alt=excluded.assets_missing_alt, assets_missing_rights=excluded.assets_missing_rights,
     completeness_score=excluded.completeness_score, calc_version=excluded.calc_version, refreshed_at=now()
  returning * into row;
  return row;
end; $$;

-- One-call refresh for a hotel/day (all four aggregates).
create or replace function public.refresh_analytics(p_hotel uuid, p_day date)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.refresh_ai_quality_daily(p_hotel, p_day);
  perform public.refresh_operations_daily(p_hotel, p_day);
  perform public.refresh_newsletter_daily(p_hotel, p_day);
  perform public.refresh_content_health_daily(p_hotel, p_day);
end; $$;

revoke all on function
  public.refresh_ai_quality_daily(uuid,date), public.refresh_operations_daily(uuid,date),
  public.refresh_newsletter_daily(uuid,date), public.refresh_content_health_daily(uuid,date),
  public.refresh_analytics(uuid,date) from public;
grant execute on function
  public.refresh_ai_quality_daily(uuid,date), public.refresh_operations_daily(uuid,date),
  public.refresh_newsletter_daily(uuid,date), public.refresh_content_health_daily(uuid,date),
  public.refresh_analytics(uuid,date) to authenticated, service_role;

-- ── RLS + GRANTS (read-only for authenticated; refreshed via DEFINER fns) ─────
alter table public.ai_quality_daily     enable row level security;
alter table public.operations_daily     enable row level security;
alter table public.newsletter_daily     enable row level security;
alter table public.content_health_daily enable row level security;

revoke all on public.ai_quality_daily, public.operations_daily, public.newsletter_daily, public.content_health_daily
  from public, anon, authenticated, service_role;

grant select, insert, update on public.ai_quality_daily     to service_role;
grant select, insert, update on public.operations_daily     to service_role;
grant select, insert, update on public.newsletter_daily     to service_role;
grant select, insert, update on public.content_health_daily to service_role;
grant select on public.ai_quality_daily, public.operations_daily, public.newsletter_daily, public.content_health_daily to authenticated;

-- Role-specific read access (no PII in any of these tables).
create policy aiq_select on public.ai_quality_daily for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor','read_only']::public.hotel_member_role[]) );
create policy ops_select on public.operations_daily for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','reception','read_only']::public.hotel_member_role[]) );
create policy nld_select on public.newsletter_daily for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','marketing','read_only']::public.hotel_member_role[]) );
create policy chd_select on public.content_health_daily for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor','read_only']::public.hotel_member_role[]) );
