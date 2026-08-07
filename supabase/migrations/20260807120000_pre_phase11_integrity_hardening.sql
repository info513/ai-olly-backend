-- ============================================================================
-- AI OLLY — Pre-Phase-11 Remediation: tenancy + same-hotel integrity hardening.
-- Forward-only, aiolly-dev. Architecture LOCKED — no redesign, no new modules.
-- Addresses independent-review findings F-03/F-04, S-01..S-06.
--   Part 1  retire/deprecate legacy publish_destination_content (snapshot bypass)
--   Part 2  profiles.active suspension now disables ordinary hotel access
--   Part 3  sign_consent same-hotel/same-guest stay validation
--   Part 4  same-hotel integrity triggers (requests/feedback/push/request_events)
--   Part 5  newsletter subscriber ⇄ consent same-hotel integrity
--   Part 6  schedule_campaign template/segment scope integrity
-- All helpers stay SECURITY DEFINER + `set search_path=''`; CREATE OR REPLACE
-- preserves existing grants; new functions get precise grants; RLS unchanged.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2 — Profile suspension semantics (S-01)
-- A globally inactive profile (profiles.active=false) must lose ALL hotel access,
-- even with an active hotel_membership. Centralised in one helper AND-ed into the
-- membership/role helpers so we don't patch dozens of policies. is_platform_admin
-- already checks active=true.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function platform.is_profile_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and active = true);
$$;
revoke all on function platform.is_profile_active() from public;
grant execute on function platform.is_profile_active() to authenticated, service_role;

create or replace function platform.has_hotel_membership(hotel_uuid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select platform.is_profile_active() and exists (
    select 1 from public.hotel_memberships
    where hotel_id = hotel_uuid and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function platform.has_hotel_role(hotel_uuid uuid, allowed hotel_member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select platform.is_profile_active() and exists (
    select 1 from public.hotel_memberships
    where hotel_id = hotel_uuid and user_id = auth.uid()
      and status = 'active' and role = any(allowed)
  );
$$;

create or replace function platform.has_destination_access(dest_uuid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select platform.is_profile_active() and exists (
    select 1 from public.hotels h
    join public.hotel_memberships m on m.hotel_id = h.id
    where h.destination_id = dest_uuid and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function platform.has_any_membership()
returns boolean language sql stable security definer set search_path = '' as $$
  select platform.is_profile_active() and exists (
    select 1 from public.hotel_memberships where user_id = auth.uid() and status = 'active'
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1 — Retire legacy publish_destination_content (F-04 / S-06)
-- The generic publisher set status='published' + wrote a content_versions row but
-- NEVER updated destination_*.published_snapshot — leaving the row in a draft==live
-- state (resolved_* falls back to the row), bypassing the snapshot contract. It also
-- still held anon EXECUTE. Disposition: keep the name working (Package A + any caller)
-- but DELEGATE to the module-specific snapshot-backed publisher, so there is no stale
-- publish path; revoke anon. Publishers self-gate on platform_admin.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.publish_destination_content(p_entity_type text, p_entity_id uuid, p_change_summary text default null)
returns public.content_versions
language plpgsql security definer set search_path = '' as $$
declare cv public.content_versions;
begin
  -- DEPRECATED shim: delegates to the module-specific publisher which writes
  -- published_snapshot. Never publishes without updating the live snapshot.
  case p_entity_type
    when 'destination_poi'     then select * into cv from public.publish_poi(p_entity_id, p_change_summary);
    when 'destination_route'   then select * into cv from public.publish_route(p_entity_id, p_change_summary);
    when 'destination_whisper' then select * into cv from public.publish_whisper(p_entity_id, p_change_summary);
    when 'destination_event'   then select * into cv from public.publish_event(p_entity_id, p_change_summary);
    else raise exception 'unknown destination entity_type %', p_entity_type using errcode = '22023';
  end case;
  return cv;
end; $$;
revoke all on function public.publish_destination_content(text, uuid, text) from public, anon;
grant execute on function public.publish_destination_content(text, uuid, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 3 — sign_consent same-hotel/same-guest stay integrity (F-03 / S-02)
-- Adds: stay (when supplied) must belong to the SAME hotel as the guest AND to the
-- SAME guest. Template + signature-asset checks retained. Historical signed rows
-- are immutable (trg_consents_immutable) and untouched.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.sign_consent(p_template uuid, p_guest uuid, p_stay uuid, p_signed_name text, p_device jsonb default null, p_signature_asset uuid default null)
returns public.consents
language plpgsql security definer set search_path = '' as $$
declare t public.consent_templates; g public.guests; c public.consents; sa public.assets; st public.stays;
begin
  select * into t from public.consent_templates where id = p_template;
  if t.id is null then raise exception 'template % not found', p_template using errcode='P0002'; end if;
  if t.status <> 'published' or not t.active then raise exception 'consent template must be published to sign' using errcode='42501'; end if;
  select * into g from public.guests where id = p_guest;
  if g.id is null then raise exception 'guest % not found', p_guest using errcode='P0002'; end if;
  if t.hotel_id is not null and t.hotel_id <> g.hotel_id then raise exception 'template not valid for this hotel' using errcode='23514'; end if;
  if not ( platform.is_platform_admin() or platform.has_hotel_role(g.hotel_id, array['hotel_admin','reception']::public.hotel_member_role[]) ) then
    raise exception 'insufficient privilege to record consent' using errcode='42501';
  end if;
  -- same-hotel / same-guest stay integrity
  if p_stay is not null then
    select * into st from public.stays where id = p_stay;
    if st.id is null then raise exception 'stay % not found', p_stay using errcode='P0002'; end if;
    if st.hotel_id <> g.hotel_id then raise exception 'stay belongs to another hotel' using errcode='23514'; end if;
    if st.guest_id is distinct from p_guest then raise exception 'stay belongs to another guest' using errcode='23514'; end if;
  end if;
  if p_signature_asset is not null then
    select * into sa from public.assets where id = p_signature_asset;
    if sa.id is null then raise exception 'signature asset % not found', p_signature_asset using errcode='P0002'; end if;
    if sa.asset_type <> 'consent_signature' then raise exception 'asset % is not a consent signature', p_signature_asset using errcode='23514'; end if;
    if sa.hotel_id is null or sa.hotel_id <> g.hotel_id then raise exception 'signature asset belongs to another hotel' using errcode='23514'; end if;
  end if;
  insert into public.consents (hotel_id, guest_id, stay_id, template_id, consent_type, consent_version, locale,
     consent_text_snapshot, signed_name, signed_at, staff_user_id, device_metadata, signature_asset_id, status)
  values (g.hotel_id, p_guest, p_stay, p_template, t.key, t.version, t.locale, t.body_text, p_signed_name, now(),
     auth.uid(), p_device, p_signature_asset, 'granted')
  returning * into c;
  if p_signature_asset is not null then
    insert into public.asset_usages (asset_id, hotel_id, entity_type, entity_id, usage_role, created_by)
    values (p_signature_asset, g.hotel_id, 'consent', c.id, 'signature', auth.uid())
    on conflict (asset_id, entity_type, entity_id, usage_role) do nothing;
  end if;
  return c;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 4 — Same-hotel integrity triggers for operational relationships (F-03 / S-03)
-- RLS is not enough: a row with hotel_id=A must never reference hotel B's entities.
-- SECURITY DEFINER trigger fns (bypass RLS) validate referenced hotel_id == NEW.hotel_id.
-- Only non-null FKs are checked. errcode 23514 (check violation).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function platform.enforce_guest_request_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.guest_id is not null and (select hotel_id from public.guests where id = new.guest_id) is distinct from new.hotel_id
    then raise exception 'guest_request.guest_id belongs to another hotel' using errcode='23514'; end if;
  if new.stay_id is not null and (select hotel_id from public.stays where id = new.stay_id) is distinct from new.hotel_id
    then raise exception 'guest_request.stay_id belongs to another hotel' using errcode='23514'; end if;
  if new.room_id is not null and (select hotel_id from public.rooms where id = new.room_id) is distinct from new.hotel_id
    then raise exception 'guest_request.room_id belongs to another hotel' using errcode='23514'; end if;
  return new;
end; $$;
drop trigger if exists trg_guest_requests_scope on public.guest_requests;
create trigger trg_guest_requests_scope before insert or update on public.guest_requests
  for each row execute function platform.enforce_guest_request_scope();

create or replace function platform.enforce_feedback_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stay_id is not null and (select hotel_id from public.stays where id = new.stay_id) is distinct from new.hotel_id
    then raise exception 'feedback.stay_id belongs to another hotel' using errcode='23514'; end if;
  if new.room_id is not null and (select hotel_id from public.rooms where id = new.room_id) is distinct from new.hotel_id
    then raise exception 'feedback.room_id belongs to another hotel' using errcode='23514'; end if;
  return new;
end; $$;
drop trigger if exists trg_feedback_scope on public.feedback;
create trigger trg_feedback_scope before insert or update on public.feedback
  for each row execute function platform.enforce_feedback_scope();

create or replace function platform.enforce_push_subscription_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stay_id is not null and (select hotel_id from public.stays where id = new.stay_id) is distinct from new.hotel_id
    then raise exception 'push_subscription.stay_id belongs to another hotel' using errcode='23514'; end if;
  return new;
end; $$;
drop trigger if exists trg_push_subscriptions_scope on public.push_subscriptions;
create trigger trg_push_subscriptions_scope before insert or update on public.push_subscriptions
  for each row execute function platform.enforce_push_subscription_scope();

create or replace function platform.enforce_request_event_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.request_id is not null and (select hotel_id from public.guest_requests where id = new.request_id) is distinct from new.hotel_id
    then raise exception 'request_event.request_id belongs to another hotel' using errcode='23514'; end if;
  return new;
end; $$;
drop trigger if exists trg_request_events_scope on public.request_events;
create trigger trg_request_events_scope before insert on public.request_events
  for each row execute function platform.enforce_request_event_scope();

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 5 — Newsletter subscriber ⇄ consent same-hotel integrity (S-04)
-- Trigger: newsletter_subscribers.consent_id (and guest_id) must belong to the same
-- hotel. Resolvers additionally require consent.hotel_id = subscriber.hotel_id so a
-- foreign granted consent can never make a subscriber eligible.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function platform.enforce_newsletter_subscriber_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.consent_id is not null and (select hotel_id from public.consents where id = new.consent_id) is distinct from new.hotel_id
    then raise exception 'newsletter_subscriber.consent_id belongs to another hotel' using errcode='23514'; end if;
  if new.guest_id is not null and (select hotel_id from public.guests where id = new.guest_id) is distinct from new.hotel_id
    then raise exception 'newsletter_subscriber.guest_id belongs to another hotel' using errcode='23514'; end if;
  return new;
end; $$;
drop trigger if exists trg_newsletter_subscribers_scope on public.newsletter_subscribers;
create trigger trg_newsletter_subscribers_scope before insert or update on public.newsletter_subscribers
  for each row execute function platform.enforce_newsletter_subscriber_scope();

create or replace function public.resolve_newsletter_audience(p_segment uuid)
returns table(subscriber_id uuid, email text, locale text)
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
      and exists (select 1 from public.consents co where co.id = sub.consent_id and co.status = 'granted' and co.hotel_id = sub.hotel_id)
      and ( s.type = 'rule'
            or exists (select 1 from public.newsletter_segment_members m where m.segment_id = s.id and m.subscriber_id = sub.id) )
      and (loc  is null or sub.locale = loc)
      and (ctry is null or sub.country_code = ctry);
end; $$;

create or replace function public.newsletter_consent_status(p_hotel uuid)
returns table(subscriber_id uuid, consent_state text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ( platform.is_platform_admin()
           or platform.has_hotel_role(p_hotel, array['hotel_admin','marketing','reception']::public.hotel_member_role[]) ) then
    raise exception 'insufficient privilege' using errcode='42501';
  end if;
  return query
    select sub.id,
           case when sub.consent_id is null then 'missing'
                when co.status = 'granted' then 'active'
                when co.status = 'revoked' then 'revoked'
                else 'missing' end
    from public.newsletter_subscribers sub
    left join public.consents co on co.id = sub.consent_id and co.hotel_id = sub.hotel_id
    where sub.hotel_id = p_hotel;
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 6 — schedule_campaign template/segment scope integrity (S-05)
-- A hotel-A campaign must never snapshot hotel-B's template or segment. Platform-
-- default templates (hotel_id NULL) remain intentionally shareable across hotels.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.schedule_campaign(p_campaign uuid, p_scheduled_at timestamptz)
returns public.newsletter_campaigns
language plpgsql security definer set search_path = '' as $$
declare c public.newsletter_campaigns; t public.newsletter_templates; s public.newsletter_segments; live jsonb;
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
  -- template must be this hotel's, or a platform-default (hotel_id null)
  if t.hotel_id is not null and t.hotel_id <> c.hotel_id then
    raise exception 'campaign template belongs to another hotel' using errcode='42501'; end if;
  live := coalesce(t.published_snapshot, jsonb_build_object('subject', t.subject, 'preview_text', t.preview_text, 'content', t.content));
  select * into s from public.newsletter_segments where id = c.segment_id;
  -- segment (when set) must belong to this hotel
  if s.id is not null and s.hotel_id <> c.hotel_id then
    raise exception 'campaign segment belongs to another hotel' using errcode='42501'; end if;
  update public.newsletter_campaigns set
     subject_snapshot = live->>'subject', preview_text_snapshot = live->>'preview_text', content_snapshot = live->'content',
     segment_snapshot = case when s.id is not null then to_jsonb(s) else null end,
     status = 'scheduled', scheduled_at = p_scheduled_at, updated_at = now()
   where id = p_campaign returning * into c;
  return c;
end; $$;

-- Re-harden grants on the new trigger functions (revoke from public; triggers run as
-- definer and need no caller grant). CREATE OR REPLACE preserved grants on the RPCs.
revoke all on function platform.enforce_guest_request_scope() from public;
revoke all on function platform.enforce_feedback_scope() from public;
revoke all on function platform.enforce_push_subscription_scope() from public;
revoke all on function platform.enforce_request_event_scope() from public;
revoke all on function platform.enforce_newsletter_subscriber_scope() from public;
