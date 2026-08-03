-- ============================================================================
-- Newsletter consent-status visibility for marketing (Sprint 7; additive).
-- ----------------------------------------------------------------------------
-- Marketing manages subscribers but (correctly) CANNOT read the consents table —
-- consents_select is hotel_admin/reception/platform_admin only (PII/text). So the
-- subscriber list couldn't distinguish active vs revoked vs missing consent for a
-- marketing user. Expose ONLY the derived state (no consent text, no PII) via a
-- member-scoped SECURITY DEFINER function. Send-time gating is unchanged and still
-- enforced by resolve_newsletter_audience (granted consent required).
-- ============================================================================

create or replace function public.newsletter_consent_status(p_hotel uuid)
returns table (subscriber_id uuid, consent_state text)
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
    left join public.consents co on co.id = sub.consent_id
    where sub.hotel_id = p_hotel;
end; $$;

revoke all on function public.newsletter_consent_status(uuid) from public, anon;
grant execute on function public.newsletter_consent_status(uuid) to authenticated, service_role;
