-- ============================================================================
-- Platform CMS — Destination AI (Phase 8): rollback_knowledge_article fix.
-- ----------------------------------------------------------------------------
-- The Destination AI module reuses knowledge_articles + its publish/rollback/
-- history RPCs unchanged. One latent bug surfaces for destination-scope answers,
-- which frequently have only an approved_answer and NO structured body:
--   rollback set body_content = snap->'body_content', but to_jsonb() encodes a
--   NULL column as JSON null, and the destination_* body CHECK (NULL-or-object)
--   rejects JSON null → rollback failed for any article without a body.
-- FIX (create-or-replace, no signature change): coerce JSON null → SQL NULL, and
-- also restore category_id + is_critical (fields the editor manages) so a rollback
-- is faithful. Behaviour for hotel-scoped articles is unchanged. No redesign.
-- ============================================================================

create or replace function public.rollback_knowledge_article(p_article uuid, p_version uuid)
returns public.knowledge_articles
language plpgsql security definer set search_path = '' as $$
declare snap jsonb; a public.knowledge_articles; cvrow public.content_versions;
begin
  select * into cvrow from public.content_versions where id=p_version and entity_type='knowledge_article' and entity_id=p_article;
  if cvrow.id is null then raise exception 'version % not found for article %', p_version, p_article using errcode='P0002'; end if;
  select * into a from public.knowledge_articles where id = p_article;
  if not ( platform.is_platform_admin()
           or ( a.hotel_id is not null
                and platform.has_hotel_role(a.hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) ) ) then
    raise exception 'insufficient privilege to roll back article %', p_article using errcode = '42501';
  end if;
  snap := cvrow.snapshot;
  update public.knowledge_articles set
     title=coalesce(snap->>'title', title),
     body_content = case when jsonb_typeof(snap->'body_content') = 'object' then snap->'body_content' else null end,
     approved_answer=snap->>'approved_answer',
     category_id=nullif(snap->>'category_id','')::uuid,
     priority=coalesce((snap->>'priority')::int, priority),
     is_critical=coalesce((snap->>'is_critical')::boolean, is_critical),
     available_to_ai=coalesce((snap->>'available_to_ai')::boolean, available_to_ai),
     valid_from=nullif(snap->>'valid_from','')::timestamptz, valid_to=nullif(snap->>'valid_to','')::timestamptz,
     status='draft', updated_by=auth.uid()
   where id=p_article returning * into a;
  return a;
end; $$;
