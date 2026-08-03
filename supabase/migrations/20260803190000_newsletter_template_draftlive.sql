-- ============================================================================
-- Newsletter template Draft/Live + hardening (Sprint 7; additive, aiolly-dev).
-- ----------------------------------------------------------------------------
-- FINDING 1 — mutable-live defect (same class as Services/Knowledge/Consent).
-- newsletter_templates has ONE row per (hotel,key,locale); schedule_campaign
-- snapshotted subject/preview_text/content from that LIVE row, and the protect
-- trigger did not freeze content once published. So editing a published template
-- changed what a NEW campaign would freeze at schedule time, with no version bump.
-- (Already-scheduled/sent campaigns were always safe — their snapshot is frozen.)
-- FIX mirrors Services: add published_snapshot (the LIVE, last-published subject/
-- preview/content), written ONLY by publish_newsletter_template; schedule_campaign
-- now freezes from that snapshot. Draft edits to the row no longer change the live
-- template until the next publish. Add rollback (restores into a new draft, never
-- touches the snapshot) + a member-scoped version-history read.
--
-- FINDING 2 — anon EXECUTE regression on publish_newsletter_template /
-- schedule_campaign / resolve_newsletter_audience (created with default PUBLIC/
-- anon EXECUTE). Revoke PUBLIC/anon; re-grant authenticated + service_role.
-- ============================================================================

alter table public.newsletter_templates add column if not exists published_snapshot jsonb;

update public.newsletter_templates
   set published_snapshot = jsonb_build_object('subject', subject, 'preview_text', preview_text, 'content', content,
        'name', name, 'locale', locale, 'header_asset_id', header_asset_id, 'published_at', published_at)
 where status = 'published' and published_snapshot is null;

-- ── publish records the live snapshot alongside the immutable version ─────────
create or replace function public.publish_newsletter_template(p_template uuid, p_change_summary text default null)
returns public.content_versions language plpgsql volatile security definer set search_path = '' as $$
declare t public.newsletter_templates; vnum int; cv public.content_versions; snap jsonb;
begin
  select * into t from public.newsletter_templates where id = p_template;
  if t.id is null then raise exception 'template % not found', p_template using errcode='P0002'; end if;
  if not ( platform.is_platform_admin()
           or (t.hotel_id is not null and platform.has_hotel_role(t.hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[])) ) then
    raise exception 'insufficient privilege to publish template %', p_template using errcode='42501';
  end if;
  select coalesce(max(version_number),0)+1 into vnum from public.content_versions where entity_type='newsletter_template' and entity_id=p_template;
  update public.newsletter_templates set status='published', published_at=now(), updated_by=auth.uid() where id=p_template returning * into t;
  snap := jsonb_build_object('subject', t.subject, 'preview_text', t.preview_text, 'content', t.content,
            'name', t.name, 'locale', t.locale, 'header_asset_id', t.header_asset_id, 'published_at', t.published_at);
  update public.newsletter_templates set published_snapshot = snap where id = p_template;
  insert into public.content_versions (entity_type, entity_id, version_number, status, snapshot, change_summary, hotel_id, published_at, created_by)
  values ('newsletter_template', p_template, vnum, 'published', to_jsonb(t) - 'published_snapshot', p_change_summary, t.hotel_id, now(), auth.uid())
  returning * into cv;
  return cv;
end; $$;

-- ── schedule freezes from the template's LIVE published snapshot ──────────────
create or replace function public.schedule_campaign(p_campaign uuid, p_scheduled_at timestamptz)
returns public.newsletter_campaigns language plpgsql volatile security definer set search_path = '' as $$
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
  -- LIVE content = published_snapshot (fallback to live columns for any pre-backfill row)
  live := coalesce(t.published_snapshot, jsonb_build_object('subject', t.subject, 'preview_text', t.preview_text, 'content', t.content));
  select * into s from public.newsletter_segments where id = c.segment_id;
  update public.newsletter_campaigns set
     subject_snapshot = live->>'subject', preview_text_snapshot = live->>'preview_text', content_snapshot = live->'content',
     segment_snapshot = case when s.id is not null then to_jsonb(s) else null end,
     status = 'scheduled', scheduled_at = p_scheduled_at, updated_at = now()
   where id = p_campaign returning * into c;
  return c;
end; $$;

-- ── rollback restores a version into a NEW draft (never touches the snapshot) ──
create or replace function public.rollback_newsletter_template(p_template uuid, p_version uuid)
returns public.newsletter_templates language plpgsql volatile security definer set search_path = '' as $$
declare t public.newsletter_templates; cvrow public.content_versions; snap jsonb;
begin
  select * into cvrow from public.content_versions where id = p_version and entity_type='newsletter_template' and entity_id=p_template;
  if cvrow.id is null then raise exception 'version % not found for template %', p_version, p_template using errcode='P0002'; end if;
  select * into t from public.newsletter_templates where id = p_template;
  if t.id is null then raise exception 'template % not found', p_template using errcode='P0002'; end if;
  if not ( platform.is_platform_admin()
           or (t.hotel_id is not null and platform.has_hotel_role(t.hotel_id, array['hotel_admin','marketing']::public.hotel_member_role[])) ) then
    raise exception 'insufficient privilege to roll back template %', p_template using errcode='42501';
  end if;
  snap := cvrow.snapshot;
  update public.newsletter_templates set
     subject = coalesce(snap->>'subject', subject), preview_text = snap->>'preview_text',
     content = snap->'content', name = coalesce(snap->>'name', name), status = 'draft', updated_by = auth.uid()
   where id = p_template returning * into t;   -- live (published_snapshot) unchanged until re-publish
  return t;
end; $$;

-- ── member-scoped version history read (content_versions stays closed) ────────
create or replace function public.list_newsletter_template_versions(p_template uuid)
returns table (id uuid, version_number integer, status public.content_status, change_summary text,
               created_by uuid, published_at timestamptz, created_at timestamptz, snapshot jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare t public.newsletter_templates;
begin
  select nt.* into t from public.newsletter_templates nt where nt.id = p_template;
  if t.id is null then return; end if;
  if not ( platform.is_platform_admin()
           or (t.hotel_id is not null and platform.has_hotel_membership(t.hotel_id))
           or (t.hotel_id is null and platform.has_any_membership()) ) then
    raise exception 'insufficient privilege to read template history' using errcode='42501';
  end if;
  return query
    select v.id, v.version_number, v.status, v.change_summary, v.created_by, v.published_at, v.created_at, v.snapshot
    from public.content_versions v
    where v.entity_type='newsletter_template' and v.entity_id=p_template
    order by v.version_number desc;
end; $$;

-- ── re-apply EXECUTE grants (create-or-replace reset them to PUBLIC) ──────────
revoke all on function public.publish_newsletter_template(uuid, text) from public, anon;
grant execute on function public.publish_newsletter_template(uuid, text) to authenticated, service_role;
revoke all on function public.schedule_campaign(uuid, timestamptz) from public, anon;
grant execute on function public.schedule_campaign(uuid, timestamptz) to authenticated, service_role;
revoke all on function public.resolve_newsletter_audience(uuid) from public, anon;
grant execute on function public.resolve_newsletter_audience(uuid) to authenticated, service_role;
revoke all on function public.rollback_newsletter_template(uuid, uuid) from public, anon;
grant execute on function public.rollback_newsletter_template(uuid, uuid) to authenticated, service_role;
revoke all on function public.list_newsletter_template_versions(uuid) from public, anon;
grant execute on function public.list_newsletter_template_versions(uuid) to authenticated, service_role;
