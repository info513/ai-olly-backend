-- ============================================================================
-- Draft/Live separation for AI Knowledge (Sprint 4; additive, aiolly-dev only).
-- ----------------------------------------------------------------------------
-- DEFECT (same class as Hotel Services): resolved_ai_knowledge read LIVE content
-- from the mutable knowledge_articles row, so editing a published article changed
-- live AI retrieval immediately. Fix mirrors Services:
--   • knowledge_articles.published_snapshot (nullable) = the currently-LIVE content,
--     written ONLY by publish_knowledge_article; backfill existing published rows.
--   • resolved_ai_knowledge LIVE mode reads content from published_snapshot (with a
--     fallback to the live row for directly-published rows); PREVIEW mode reads the
--     live row (drafts included, RLS gates to authors).
--   • rollback_knowledge_article is unchanged — restores into a new DRAFT, never
--     touches the snapshot (live retrieval keeps the last published version).
--   • add list_article_versions(uuid): member-scoped read of content_versions for
--     History/rollback (content_versions stays closed to app roles).
--   • re-apply EXECUTE grants (create-or-replace resets privileges to PUBLIC).
-- ============================================================================

alter table public.knowledge_articles add column if not exists published_snapshot jsonb;

update public.knowledge_articles
   set published_snapshot = to_jsonb(knowledge_articles.*) - 'published_snapshot'
 where status = 'published' and published_snapshot is null;

-- ── publish records the live snapshot alongside the immutable version ─────────
create or replace function public.publish_knowledge_article(
  p_article uuid, p_change_summary text default null, p_acknowledge_critical boolean default false
) returns public.content_versions
language plpgsql volatile security definer set search_path = '' as $$
declare a public.knowledge_articles; vnum int; cv public.content_versions; snap jsonb;
begin
  select * into a from public.knowledge_articles where id = p_article;
  if a.id is null then raise exception 'article % not found', p_article using errcode = 'P0002'; end if;
  if not ( platform.is_platform_admin()
           or ( a.hotel_id is not null
                and platform.has_hotel_role(a.hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) ) ) then
    raise exception 'insufficient privilege to publish article %', p_article using errcode = '42501';
  end if;
  if a.is_critical and not p_acknowledge_critical then
    raise exception 'article % is critical; explicit acknowledgement required to publish', p_article using errcode = 'P0001';
  end if;
  select coalesce(max(version_number),0)+1 into vnum from public.content_versions where entity_type='knowledge_article' and entity_id=p_article;
  update public.knowledge_articles
     set status='published', published_at=now(),
         last_critical_ack_at = case when a.is_critical then now() else last_critical_ack_at end,
         last_critical_ack_by = case when a.is_critical then auth.uid() else last_critical_ack_by end,
         updated_by = auth.uid()
   where id = p_article returning * into a;
  snap := to_jsonb(a) - 'published_snapshot';
  update public.knowledge_articles set published_snapshot = snap where id = p_article;
  insert into public.content_versions (entity_type, entity_id, version_number, status, snapshot, change_summary, hotel_id, published_at, created_by)
  values ('knowledge_article', p_article, vnum, 'published', snap, p_change_summary, a.hotel_id, now(), auth.uid())
  returning * into cv;
  return cv;
end; $$;

-- ── resolved AI knowledge: LIVE = snapshot; PREVIEW = live row (author drafts) ─
create or replace function public.resolved_ai_knowledge(p_hotel uuid, p_locale text default 'en', p_preview boolean default false)
returns table (
  article_id uuid, source public.knowledge_source_type, key text, title text,
  body_content jsonb, approved_answer text, priority integer, is_critical boolean,
  category_id uuid, published_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  with dest as (select destination_id from public.hotels where id = p_hotel),
  cand as (
    select a.id, a.hotel_id, a.key,
      case when a.hotel_id is not null then 3 when a.destination_id is not null then 2 else 1 end as prec,
      case when p_preview then to_jsonb(a) - 'published_snapshot'
           else coalesce(a.published_snapshot, case when a.status = 'published' then to_jsonb(a) - 'published_snapshot' else null end)
      end as snap
    from public.knowledge_articles a
    where a.locale = p_locale
      and a.status <> 'archived'
      and (p_preview or a.published_snapshot is not null or a.status = 'published')
      and ( a.hotel_id = p_hotel
            or (a.hotel_id is null and a.destination_id = (select destination_id from dest))
            or (a.hotel_id is null and a.destination_id is null) )
  ),
  live as (
    select
      id, hotel_id, key, prec,
      (snap->>'source_type')::public.knowledge_source_type as source,
      snap->>'title' as title, snap->'body_content' as body_content, snap->>'approved_answer' as approved_answer,
      coalesce((snap->>'priority')::int, 0) as priority, coalesce((snap->>'is_critical')::boolean, false) as is_critical,
      (snap->>'category_id')::uuid as category_id, nullif(snap->>'published_at','')::timestamptz as published_at
    from cand
    where snap is not null
      and coalesce((snap->>'active')::boolean, true)
      and coalesce((snap->>'available_to_ai')::boolean, false)
      and (nullif(snap->>'valid_from','')::timestamptz is null or (snap->>'valid_from')::timestamptz <= now())
      and (nullif(snap->>'valid_to','')::timestamptz   is null or (snap->>'valid_to')::timestamptz   >= now())
  )
  select distinct on (key)
    id, source, key, title, body_content, approved_answer, priority, is_critical, category_id, published_at
  from live
  order by key, prec desc, published_at desc nulls last;
$$;

-- ── member-scoped read of a knowledge article's version history ──────────────
create or replace function public.list_article_versions(p_article uuid)
returns table (id uuid, version_number integer, status public.content_status, change_summary text,
               created_by uuid, published_at timestamptz, created_at timestamptz, snapshot jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare a public.knowledge_articles;
begin
  select ka.* into a from public.knowledge_articles ka where ka.id = p_article;
  if a.id is null then return; end if;
  if not ( platform.is_platform_admin()
           or ( a.hotel_id is not null and platform.has_hotel_membership(a.hotel_id) )
           or ( a.destination_id is not null and platform.has_destination_access(a.destination_id) ) ) then
    raise exception 'insufficient privilege to read article history' using errcode = '42501';
  end if;
  return query
    select v.id, v.version_number, v.status, v.change_summary, v.created_by, v.published_at, v.created_at, v.snapshot
    from public.content_versions v
    where v.entity_type = 'knowledge_article' and v.entity_id = p_article
    order by v.version_number desc;
end; $$;

-- ── re-apply EXECUTE grants (create-or-replace reset them to PUBLIC) ──────────
revoke all on function public.publish_knowledge_article(uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.publish_knowledge_article(uuid, text, boolean) to authenticated, service_role;
revoke all on function public.resolved_ai_knowledge(uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.resolved_ai_knowledge(uuid, text, boolean) to authenticated, service_role;
revoke all on function public.list_article_versions(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_article_versions(uuid) to authenticated, service_role;
-- rollback_knowledge_article / publish_ai_config / resolved_ai_config unchanged (grants intact).
