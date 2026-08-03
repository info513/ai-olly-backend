-- ============================================================================
-- Asset Manager / Consent-signature wiring (Sprint 6; additive, aiolly-dev only).
-- ----------------------------------------------------------------------------
-- FINDING 1 — private-asset write scope too broad. assets INSERT/UPDATE allowed
-- hotel_admin/editor/marketing for ANY asset_type, so editor/marketing could
-- create/edit private consent asset rows (consent_signature/consent_pdf/document)
-- even though the SELECT policy correctly hides private types from them and the
-- private buckets are service-role-only. Part 10 says editor/marketing get NO
-- consent files. FIX: gate writes by type — private types require platform_admin
-- or hotel_admin/reception; non-private keep hotel_admin/editor/marketing.
--
-- FEATURE — sign_consent gains an optional signature asset. The consents table
-- has signature_asset_id but sign_consent never set it, and signed consents are
-- immutable (cannot attach afterwards). Replace sign_consent to accept
-- p_signature_asset: validate it is a consent_signature in the same hotel, store
-- it on the immutable consent, and record an asset_usage(entity='consent',
-- role='signature'). A missing arg keeps the old behaviour (no signature).
--
-- FINDING 2 — anon EXECUTE regression on finalize_asset + asset_usage_report
-- (created in Step 11 with default PUBLIC/anon EXECUTE). Revoke PUBLIC/anon;
-- re-grant authenticated + service_role. Data was already protected by internal
-- authz + RLS; this closes the hardening gap.
-- ============================================================================

-- ── FINDING 1: type-aware private-asset write policies ───────────────────────
drop policy if exists assets_ins on public.assets;
create policy assets_ins on public.assets for insert to authenticated
  with check (
    case when platform.asset_is_private_type(asset_type)
      then ( platform.is_platform_admin()
             or (hotel_id is not null and platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[])) )
      else ( (hotel_id is null and platform.is_platform_admin())
             or (hotel_id is not null and (platform.is_platform_admin()
                   or platform.has_hotel_role(hotel_id, array['hotel_admin','editor','marketing']::public.hotel_member_role[]))) )
    end );

drop policy if exists assets_upd on public.assets;
create policy assets_upd on public.assets for update to authenticated
  using (
    case when platform.asset_is_private_type(asset_type)
      then ( platform.is_platform_admin()
             or (hotel_id is not null and platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[])) )
      else ( (hotel_id is null and platform.is_platform_admin())
             or (hotel_id is not null and (platform.is_platform_admin()
                   or platform.has_hotel_role(hotel_id, array['hotel_admin','editor','marketing']::public.hotel_member_role[]))) )
    end )
  with check (
    case when platform.asset_is_private_type(asset_type)
      then ( platform.is_platform_admin()
             or (hotel_id is not null and platform.has_hotel_role(hotel_id, array['hotel_admin','reception']::public.hotel_member_role[])) )
      else ( (hotel_id is null and platform.is_platform_admin())
             or (hotel_id is not null and (platform.is_platform_admin()
                   or platform.has_hotel_role(hotel_id, array['hotel_admin','editor','marketing']::public.hotel_member_role[]))) )
    end );

-- ── FEATURE: sign_consent with an optional signature asset ───────────────────
drop function if exists public.sign_consent(uuid, uuid, uuid, text, jsonb);
create or replace function public.sign_consent(
  p_template uuid, p_guest uuid, p_stay uuid, p_signed_name text,
  p_device jsonb default null, p_signature_asset uuid default null
) returns public.consents language plpgsql volatile security definer set search_path = '' as $$
declare t public.consent_templates; g public.guests; c public.consents; sa public.assets;
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
  -- record where the signature is used (immutable evidence; scope-checked by trigger)
  if p_signature_asset is not null then
    insert into public.asset_usages (asset_id, hotel_id, entity_type, entity_id, usage_role, created_by)
    values (p_signature_asset, g.hotel_id, 'consent', c.id, 'signature', auth.uid())
    on conflict (asset_id, entity_type, entity_id, usage_role) do nothing;
  end if;
  return c;
end; $$;
revoke all on function public.sign_consent(uuid, uuid, uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.sign_consent(uuid, uuid, uuid, text, jsonb, uuid) to authenticated, service_role;

-- ── FINDING 2: re-harden asset function grants ───────────────────────────────
revoke all on function public.finalize_asset(uuid, bigint, text, integer, integer, integer) from public, anon;
grant execute on function public.finalize_asset(uuid, bigint, text, integer, integer, integer) to authenticated, service_role;
revoke all on function public.asset_usage_report(uuid) from public, anon;
grant execute on function public.asset_usage_report(uuid) to authenticated, service_role;
