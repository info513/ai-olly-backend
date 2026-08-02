-- ============================================================================
-- AI OLLY Platform 2.0 — Migration Step 8: AI Knowledge
-- ----------------------------------------------------------------------------
-- Structured knowledge CMS (NOT a 1:1 import of the 617 Airtable patterns):
-- knowledge_categories, knowledge_articles (platform/destination/hotel + override),
-- knowledge_article_sources, knowledge_aliases, ai_configs, ai_response_logs,
-- unanswered_questions, knowledge_embeddings (schema-readiness placeholder).
-- Publishing/versioning via content_versions (Step 1); redacted audit; tenant-safe
-- resolved_ai_knowledge()/resolved_ai_config(). RLS from row one. aiolly-dev only.
-- Logic stays in code — only FACTS/approved content live here. Idempotent.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'knowledge_source_type') then
    create type public.knowledge_source_type as enum ('platform','destination','hotel','override');
  end if;
end $$;

-- ── knowledge_categories (platform default vs hotel scope) ───────────────────
create table if not exists public.knowledge_categories (
  id                        uuid primary key default gen_random_uuid(),
  hotel_id                  uuid references public.hotels(id) on delete cascade,
  key                       text not null,
  name                      text not null,
  sort_order                integer not null default 0,
  active                    boolean not null default true,
  legacy_airtable_record_id text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid,
  updated_by                uuid,
  constraint knowledge_categories_key_fmt check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create unique index if not exists knowledge_categories_key_platform on public.knowledge_categories (key) where hotel_id is null;
create unique index if not exists knowledge_categories_key_hotel    on public.knowledge_categories (hotel_id, key) where hotel_id is not null;

-- ── knowledge_articles (platform / destination / hotel / override) ───────────
create table if not exists public.knowledge_articles (
  id                        uuid primary key default gen_random_uuid(),
  hotel_id                  uuid references public.hotels(id) on delete cascade,       -- null = platform/destination
  destination_id            uuid references public.destinations(id) on delete cascade, -- set (hotel null) = destination scope
  category_id               uuid references public.knowledge_categories(id) on delete set null,
  key                       text not null,
  title                     text not null,
  body_content              jsonb,                    -- structured blocks (validated)
  approved_answer           text,                     -- optional concise approved answer for AI
  locale                    text not null default 'en',
  status                    public.content_status not null default 'draft',
  active                    boolean not null default true,
  available_to_ai           boolean not null default true,
  source_type               public.knowledge_source_type not null default 'hotel',    -- derived by trigger
  source_entity_type        text,
  source_entity_id          uuid,
  priority                  integer not null default 0,
  is_critical               boolean not null default false,
  valid_from                timestamptz,
  valid_to                  timestamptz,
  override_of_article_id    uuid references public.knowledge_articles(id) on delete set null,
  published_at              timestamptz,
  last_critical_ack_at      timestamptz,
  last_critical_ack_by      uuid,
  legacy_airtable_record_id text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid,
  updated_by                uuid,
  constraint knowledge_articles_key_fmt    check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint knowledge_articles_locale_fmt check (locale ~ '^[a-z]{2}(-[a-z]{2})?$'),
  constraint knowledge_articles_body_valid check (body_content is null or platform.is_valid_service_body(body_content)),
  constraint knowledge_articles_valid_range check (valid_to is null or valid_from is null or valid_to >= valid_from),
  constraint knowledge_articles_scope check (hotel_id is null or destination_id is null)  -- not both
);
create unique index if not exists knowledge_articles_key_platform on public.knowledge_articles (locale, key)
  where hotel_id is null and destination_id is null;
create unique index if not exists knowledge_articles_key_dest on public.knowledge_articles (destination_id, locale, key)
  where hotel_id is null and destination_id is not null;
create unique index if not exists knowledge_articles_key_hotel on public.knowledge_articles (hotel_id, locale, key)
  where hotel_id is not null;
create index if not exists knowledge_articles_hotel_idx on public.knowledge_articles (hotel_id);
create index if not exists knowledge_articles_dest_idx  on public.knowledge_articles (destination_id);
create index if not exists knowledge_articles_live_idx  on public.knowledge_articles (locale, status, active);

-- ── knowledge_article_sources (provenance; many per article) ─────────────────
create table if not exists public.knowledge_article_sources (
  id                 uuid primary key default gen_random_uuid(),
  article_id         uuid not null references public.knowledge_articles(id) on delete cascade,
  source_entity_type text,
  source_entity_id   uuid,
  url                text,
  note               text,
  created_at         timestamptz not null default now(),
  created_by         uuid
);
create index if not exists knowledge_article_sources_article_idx on public.knowledge_article_sources (article_id);

-- ── knowledge_aliases (safe synonyms/retrieval terms; NOT the 617-pattern sys) ─
create table if not exists public.knowledge_aliases (
  id               uuid primary key default gen_random_uuid(),
  hotel_id         uuid references public.hotels(id) on delete cascade,   -- null = platform alias
  article_id       uuid references public.knowledge_articles(id) on delete cascade,
  intent_key       text,                                   -- stable intent key (deterministic handler)
  locale           text not null default 'en',
  alias_text       text not null,
  normalized_alias text generated always as (lower(btrim(alias_text))) stored,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  constraint knowledge_aliases_target check (article_id is not null or intent_key is not null),
  constraint knowledge_aliases_locale_fmt check (locale ~ '^[a-z]{2}(-[a-z]{2})?$'),
  constraint knowledge_aliases_len check (char_length(btrim(alias_text)) >= 2)  -- avoid broad unsafe matching
);
create unique index if not exists knowledge_aliases_unique on public.knowledge_aliases (coalesce(hotel_id,'00000000-0000-0000-0000-000000000000'::uuid), locale, normalized_alias);
create index if not exists knowledge_aliases_article_idx on public.knowledge_aliases (article_id);

-- ── ai_configs (editable hotel FACTS/config — never program logic) ───────────
create table if not exists public.ai_configs (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid references public.hotels(id) on delete cascade,  -- null = platform default
  persona             jsonb,
  tone                text,
  response_formatting jsonb,
  safe_handoff_text   text,
  feature_flags       jsonb,
  retrieval_limit     integer not null default 8,
  safe_keyword_aliases jsonb,
  status              public.content_status not null default 'draft',
  active              boolean not null default true,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  constraint ai_configs_retrieval check (retrieval_limit between 1 and 50)
);
create unique index if not exists ai_configs_platform_unique on public.ai_configs ((true)) where hotel_id is null;
create unique index if not exists ai_configs_hotel_unique    on public.ai_configs (hotel_id) where hotel_id is not null;

-- ── ai_response_logs (operational; guest context — sensitive; NOT public) ────
create table if not exists public.ai_response_logs (
  id                    uuid primary key default gen_random_uuid(),
  hotel_id              uuid not null references public.hotels(id) on delete cascade,
  stay_id               uuid,
  room_id               uuid references public.rooms(id) on delete set null,
  correlation_id        text,
  question              text,
  answer                text,
  route_type            text,
  knowledge_ids         uuid[],
  deterministic_handler text,
  model                 text,
  model_metadata        jsonb,
  latency_ms            integer,
  prompt_tokens         integer,
  completion_tokens     integer,
  handoff               boolean not null default false,
  quality               text,
  created_at            timestamptz not null default now(),
  expires_at            timestamptz            -- set by retention job (retention_policies drives period)
);
create index if not exists ai_response_logs_hotel_idx   on public.ai_response_logs (hotel_id, created_at);
create index if not exists ai_response_logs_expires_idx on public.ai_response_logs (expires_at);

-- ── unanswered_questions (deduped per hotel; tenant-isolated) ────────────────
create table if not exists public.unanswered_questions (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             uuid not null references public.hotels(id) on delete cascade,
  normalized_question  text not null,
  original_question    text,                    -- redacted form
  occurrence_count     integer not null default 1,
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  room_id              uuid references public.rooms(id) on delete set null,
  stay_id              uuid,
  status               text not null default 'open',
  assigned_to          uuid,
  resolution_article_id uuid references public.knowledge_articles(id) on delete set null,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid,
  constraint unanswered_questions_unique unique (hotel_id, normalized_question)
);
create index if not exists unanswered_questions_hotel_idx on public.unanswered_questions (hotel_id, status);

-- ── knowledge_embeddings (SCHEMA-READINESS placeholder; no vectors generated) ─
create table if not exists public.knowledge_embeddings (
  id               uuid primary key default gen_random_uuid(),
  article_id       uuid not null references public.knowledge_articles(id) on delete cascade,
  locale           text not null default 'en',
  model            text,
  dimensions       integer,
  content_hash     text,
  embedding_status text not null default 'pending',   -- pending|ready (vectors added in a later package)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint knowledge_embeddings_unique unique (article_id, locale, model)
);

-- updated_at triggers
create trigger trg_knowledge_categories_updated_at before update on public.knowledge_categories for each row execute function platform.set_updated_at();
create trigger trg_knowledge_articles_updated_at   before update on public.knowledge_articles   for each row execute function platform.set_updated_at();
create trigger trg_knowledge_aliases_updated_at    before update on public.knowledge_aliases    for each row execute function platform.set_updated_at();
create trigger trg_ai_configs_updated_at           before update on public.ai_configs           for each row execute function platform.set_updated_at();
create trigger trg_unanswered_questions_updated_at before update on public.unanswered_questions for each row execute function platform.set_updated_at();
create trigger trg_knowledge_embeddings_updated_at before update on public.knowledge_embeddings for each row execute function platform.set_updated_at();

-- ── Integrity: derive source_type; validate override/scope ───────────────────
create or replace function platform.normalize_knowledge_article()
returns trigger language plpgsql as $$
begin
  new.source_type := case
    when new.override_of_article_id is not null then 'override'::public.knowledge_source_type
    when new.hotel_id is not null then 'hotel'::public.knowledge_source_type
    when new.destination_id is not null then 'destination'::public.knowledge_source_type
    else 'platform'::public.knowledge_source_type end;
  return new;
end; $$;
create trigger trg_knowledge_articles_normalize before insert or update on public.knowledge_articles
  for each row execute function platform.normalize_knowledge_article();

create or replace function platform.check_knowledge_relations()
returns trigger language plpgsql as $$
declare tgt public.knowledge_articles;
begin
  if new.override_of_article_id is not null then
    if new.hotel_id is null then
      raise exception 'only a hotel article may override canonical knowledge' using errcode = '23514';
    end if;
    select * into tgt from public.knowledge_articles where id = new.override_of_article_id;
    if tgt.hotel_id is not null then
      raise exception 'override target must be platform/destination knowledge (null hotel_id)' using errcode = '23514';
    end if;
    -- an override replaces a specific logical article: same key + locale (enables dedup)
    if tgt.key <> new.key or tgt.locale <> new.locale then
      raise exception 'override must share the target article key and locale' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
create trigger trg_knowledge_articles_relations before insert or update on public.knowledge_articles
  for each row execute function platform.check_knowledge_relations();

-- ── Column protection ────────────────────────────────────────────────────────
create or replace function platform.protect_knowledge_article_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or platform.is_platform_admin() then
    return new;
  end if;
  new.hotel_id               := old.hotel_id;
  new.destination_id         := old.destination_id;
  new.override_of_article_id := old.override_of_article_id;
  new.legacy_airtable_record_id := old.legacy_airtable_record_id;
  new.created_by             := old.created_by;
  new.key                    := old.key;
  new.published_at           := old.published_at;
  new.last_critical_ack_at   := old.last_critical_ack_at;
  new.last_critical_ack_by   := old.last_critical_ack_by;
  if new.status = 'published' and old.status is distinct from 'published' then
    raise exception 'direct publish is not allowed; use public.publish_knowledge_article()' using errcode = '42501';
  end if;
  if not platform.has_hotel_role(old.hotel_id, array['hotel_admin']::public.hotel_member_role[]) then
    new.is_critical := old.is_critical;
  end if;
  return new;
end; $$;
create trigger trg_knowledge_articles_protect before update on public.knowledge_articles
  for each row execute function platform.protect_knowledge_article_columns();

create or replace function platform.protect_knowledge_category_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or platform.is_platform_admin() then return new; end if;
  new.hotel_id := old.hotel_id; new.key := old.key;
  new.legacy_airtable_record_id := old.legacy_airtable_record_id; new.created_by := old.created_by;
  return new;
end; $$;
create trigger trg_knowledge_categories_protect before update on public.knowledge_categories
  for each row execute function platform.protect_knowledge_category_columns();

-- ── Redacted audit ───────────────────────────────────────────────────────────
create or replace function platform.audit_knowledge_article()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; act public.audit_action; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op<>'DELETE' then to_jsonb(new) end;
  oj := case when tg_op<>'INSERT' then to_jsonb(old) end;
  if tg_op='INSERT' then act:='create';
  elsif tg_op='DELETE' then act:='delete';
  elsif (nj->>'status')='published' and (oj->>'status') is distinct from 'published' then act:='publish';
  elsif (nj->>'status')='archived'  and (oj->>'status') is distinct from 'archived'  then act:='archive';
  elsif (oj->>'status')='archived'  and (nj->>'status') is distinct from 'archived'  then act:='restore';
  else act:='update';
  end if;
  insert into public.audit_log (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state, metadata)
  values (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'),(oj->>'hotel_id'))::uuid, 'knowledge_article', coalesce((nj->>'id'),(oj->>'id'))::uuid, act,
     case when oj is not null then jsonb_build_object('status',oj->>'status','title',oj->>'title','is_critical',oj->>'is_critical','available_to_ai',oj->>'available_to_ai','active',oj->>'active') end,
     case when nj is not null then jsonb_build_object('status',nj->>'status','title',nj->>'title','is_critical',nj->>'is_critical','available_to_ai',nj->>'available_to_ai','active',nj->>'active') end,
     jsonb_build_object('source_type', coalesce(nj->>'source_type', oj->>'source_type'), 'locale', coalesce(nj->>'locale', oj->>'locale')));
  return coalesce(new, old);
end; $$;
create trigger trg_knowledge_articles_audit after insert or update or delete on public.knowledge_articles
  for each row execute function platform.audit_knowledge_article();

create or replace function platform.audit_ai_config()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op<>'DELETE' then to_jsonb(new) end; oj := case when tg_op<>'INSERT' then to_jsonb(old) end;
  insert into public.audit_log (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state)
  values (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'),(oj->>'hotel_id'))::uuid, 'ai_config', coalesce((nj->>'id'),(oj->>'id'))::uuid,
     case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete'
          when (nj->>'status')='published' and (oj->>'status') is distinct from 'published' then 'publish'
          else 'update' end::public.audit_action,
     case when oj is not null then jsonb_build_object('status',oj->>'status','tone',oj->>'tone','active',oj->>'active') end,
     case when nj is not null then jsonb_build_object('status',nj->>'status','tone',nj->>'tone','active',nj->>'active') end);
  return coalesce(new, old);
end; $$;
create trigger trg_ai_configs_audit after insert or update or delete on public.ai_configs
  for each row execute function platform.audit_ai_config();

-- ── Publishing (public RPC; SECURITY DEFINER) ────────────────────────────────
create or replace function public.publish_knowledge_article(
  p_article uuid, p_change_summary text default null, p_acknowledge_critical boolean default false
) returns public.content_versions
language plpgsql volatile security definer set search_path = '' as $$
declare a public.knowledge_articles; vnum int; cv public.content_versions;
begin
  select * into a from public.knowledge_articles where id = p_article;
  if a.id is null then raise exception 'article % not found', p_article using errcode = 'P0002'; end if;
  -- platform/destination knowledge => platform_admin; hotel knowledge => hotel_admin/editor
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
  insert into public.content_versions (entity_type, entity_id, version_number, status, snapshot, change_summary, hotel_id, published_at, created_by)
  values ('knowledge_article', p_article, vnum, 'published', to_jsonb(a), p_change_summary, a.hotel_id, now(), auth.uid())
  returning * into cv;
  return cv;
end; $$;

create or replace function public.rollback_knowledge_article(p_article uuid, p_version uuid)
returns public.knowledge_articles
language plpgsql volatile security definer set search_path = '' as $$
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
     title=coalesce(snap->>'title', title), body_content=snap->'body_content',
     approved_answer=snap->>'approved_answer', priority=coalesce((snap->>'priority')::int, priority),
     available_to_ai=coalesce((snap->>'available_to_ai')::boolean, available_to_ai),
     valid_from=nullif(snap->>'valid_from','')::timestamptz, valid_to=nullif(snap->>'valid_to','')::timestamptz,
     status='draft', updated_by=auth.uid()
   where id=p_article returning * into a;
  return a;
end; $$;

create or replace function public.publish_ai_config(p_config uuid, p_change_summary text default null)
returns public.content_versions
language plpgsql volatile security definer set search_path = '' as $$
declare c public.ai_configs; vnum int; cv public.content_versions;
begin
  select * into c from public.ai_configs where id = p_config;
  if c.id is null then raise exception 'ai_config % not found', p_config using errcode='P0002'; end if;
  if not ( platform.is_platform_admin()
           or ( c.hotel_id is not null and platform.has_hotel_role(c.hotel_id, array['hotel_admin']::public.hotel_member_role[]) ) ) then
    raise exception 'insufficient privilege to publish ai_config %', p_config using errcode='42501';
  end if;
  select coalesce(max(version_number),0)+1 into vnum from public.content_versions where entity_type='ai_config' and entity_id=p_config;
  update public.ai_configs set status='published', published_at=now(), updated_by=auth.uid() where id=p_config returning * into c;
  insert into public.content_versions (entity_type, entity_id, version_number, status, snapshot, change_summary, hotel_id, published_at, created_by)
  values ('ai_config', p_config, vnum, 'published', to_jsonb(c), p_change_summary, c.hotel_id, now(), auth.uid())
  returning * into cv;
  return cv;
end; $$;

revoke all on function public.publish_knowledge_article(uuid,text,boolean), public.rollback_knowledge_article(uuid,uuid), public.publish_ai_config(uuid,text) from public;
grant execute on function public.publish_knowledge_article(uuid,text,boolean), public.rollback_knowledge_article(uuid,uuid), public.publish_ai_config(uuid,text) to authenticated, service_role;

-- ── Resolved AI knowledge (deterministic; hotel>destination>platform; dedup) ─
-- SECURITY INVOKER: caller RLS decides what rows exist. preview=false => published
-- only (live). preview=true => also draft/preview, but ONLY rows the caller's RLS
-- exposes (authors of that hotel / platform_admin) — non-authors still get nothing.
create or replace function public.resolved_ai_knowledge(p_hotel uuid, p_locale text default 'en', p_preview boolean default false)
returns table (
  article_id uuid, source public.knowledge_source_type, key text, title text,
  body_content jsonb, approved_answer text, priority integer, is_critical boolean,
  category_id uuid, published_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  with dest as (select destination_id from public.hotels where id = p_hotel),
  candidates as (
    select a.*, case when a.hotel_id is not null then 3 when a.destination_id is not null then 2 else 1 end as precedence
    from public.knowledge_articles a
    where a.locale = p_locale and a.active and a.available_to_ai
      and (p_preview or a.status = 'published')
      and (a.valid_from is null or a.valid_from <= now())
      and (a.valid_to   is null or a.valid_to   >= now())
      and ( a.hotel_id = p_hotel
            or (a.hotel_id is null and a.destination_id = (select destination_id from dest))
            or (a.hotel_id is null and a.destination_id is null) )
  )
  select distinct on (c.key)
    c.id, c.source_type, c.key, c.title, c.body_content, c.approved_answer, c.priority, c.is_critical, c.category_id, c.published_at
  from candidates c
  order by c.key, c.precedence desc, c.published_at desc nulls last;
$$;

create or replace function public.resolved_ai_config(p_hotel uuid)
returns public.ai_configs
language sql stable security invoker set search_path = '' as $$
  select * from public.ai_configs
  where active and status='published' and (hotel_id = p_hotel or hotel_id is null)
  order by (hotel_id is not null) desc
  limit 1;
$$;

revoke all on function public.resolved_ai_knowledge(uuid,text,boolean), public.resolved_ai_config(uuid) from public;
grant execute on function public.resolved_ai_knowledge(uuid,text,boolean), public.resolved_ai_config(uuid) to authenticated, service_role;

-- ── RLS + GRANTS (fail-closed; REVOKE ALL then precise GRANT) ─────────────────
alter table public.knowledge_categories      enable row level security;
alter table public.knowledge_articles        enable row level security;
alter table public.knowledge_article_sources enable row level security;
alter table public.knowledge_aliases         enable row level security;
alter table public.ai_configs                enable row level security;
alter table public.ai_response_logs          enable row level security;
alter table public.unanswered_questions      enable row level security;
alter table public.knowledge_embeddings      enable row level security;

revoke all on public.knowledge_categories, public.knowledge_articles, public.knowledge_article_sources,
              public.knowledge_aliases, public.ai_configs, public.ai_response_logs,
              public.unanswered_questions, public.knowledge_embeddings
  from public, anon, authenticated, service_role;

-- service_role (Render backend) least privilege
grant select, insert, update on public.knowledge_categories      to service_role;
grant select, insert, update on public.knowledge_articles        to service_role;
grant select, insert, update, delete on public.knowledge_article_sources to service_role;
grant select, insert, update, delete on public.knowledge_aliases to service_role;
grant select, insert, update on public.ai_configs                to service_role;
grant select, insert         on public.ai_response_logs          to service_role;  -- append-only from backend
grant select, insert, update on public.unanswered_questions      to service_role;
grant select, insert, update, delete on public.knowledge_embeddings to service_role;

-- authenticated (RLS-gated)
grant select, insert, update on public.knowledge_categories      to authenticated;
grant select, insert, update on public.knowledge_articles        to authenticated;
grant select, insert, update, delete on public.knowledge_article_sources to authenticated;
grant select, insert, update, delete on public.knowledge_aliases to authenticated;
grant select, insert, update on public.ai_configs                to authenticated;
grant select                 on public.ai_response_logs          to authenticated;  -- read own hotel (RLS)
grant select, insert, update on public.unanswered_questions      to authenticated;
grant select                 on public.knowledge_embeddings      to authenticated;

-- knowledge_categories: platform scope -> platform_admin; hotel scope -> hotel_admin/editor
create policy knowledge_categories_select on public.knowledge_categories for select to authenticated
  using ( platform.is_platform_admin()
          or (hotel_id is not null and platform.has_hotel_membership(hotel_id))
          or (hotel_id is null and active and platform.has_any_membership()) );
create policy knowledge_categories_ins on public.knowledge_categories for insert to authenticated
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) );
create policy knowledge_categories_upd on public.knowledge_categories for update to authenticated
  using ( (hotel_id is null and platform.is_platform_admin())
          or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) )
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) );

-- knowledge_articles: authors see all scope statuses; members see published;
-- destination/platform published visible to accessing members. platform/destination
-- writable only by platform_admin; hotel scope by hotel_admin/editor.
create policy knowledge_articles_select on public.knowledge_articles for select to authenticated
  using ( platform.is_platform_admin()
          or (hotel_id is not null and platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))
          or (hotel_id is not null and status='published' and platform.has_hotel_membership(hotel_id))
          or (hotel_id is null and destination_id is not null and status='published' and active and platform.has_destination_access(destination_id))
          or (hotel_id is null and destination_id is null and status='published' and active and platform.has_any_membership()) );
create policy knowledge_articles_ins on public.knowledge_articles for insert to authenticated
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) );
create policy knowledge_articles_upd on public.knowledge_articles for update to authenticated
  using ( (hotel_id is null and platform.is_platform_admin())
          or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) )
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) );

-- knowledge_article_sources: follow the parent article's write scope; readable to members.
create policy knowledge_article_sources_select on public.knowledge_article_sources for select to authenticated
  using ( exists (select 1 from public.knowledge_articles a where a.id = article_id) );  -- RLS on articles gates visibility
create policy knowledge_article_sources_write on public.knowledge_article_sources for all to authenticated
  using ( exists (select 1 from public.knowledge_articles a where a.id = article_id
            and ( platform.is_platform_admin()
                  or (a.hotel_id is not null and platform.has_hotel_role(a.hotel_id, array['hotel_admin','editor']::public.hotel_member_role[])) )) )
  with check ( exists (select 1 from public.knowledge_articles a where a.id = article_id
            and ( platform.is_platform_admin()
                  or (a.hotel_id is not null and platform.has_hotel_role(a.hotel_id, array['hotel_admin','editor']::public.hotel_member_role[])) )) );

-- knowledge_aliases: platform aliases by platform_admin; hotel aliases by hotel_admin/editor; read by members.
create policy knowledge_aliases_select on public.knowledge_aliases for select to authenticated
  using ( platform.is_platform_admin()
          or (hotel_id is not null and platform.has_hotel_membership(hotel_id))
          or (hotel_id is null and active and platform.has_any_membership()) );
create policy knowledge_aliases_write on public.knowledge_aliases for all to authenticated
  using ( (hotel_id is null and platform.is_platform_admin())
          or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) )
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) );

-- ai_configs: hotel config by hotel_admin; platform config by platform_admin; read by members.
create policy ai_configs_select on public.ai_configs for select to authenticated
  using ( platform.is_platform_admin()
          or (hotel_id is not null and platform.has_hotel_membership(hotel_id))
          or (hotel_id is null and active and platform.has_any_membership()) );
create policy ai_configs_ins on public.ai_configs for insert to authenticated
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]))) );
create policy ai_configs_upd on public.ai_configs for update to authenticated
  using ( (hotel_id is null and platform.is_platform_admin())
          or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]))) )
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]))) );

-- ai_response_logs: sensitive guest context — hotel_admin (+platform_admin) read own hotel only. No authenticated insert (service_role only).
create policy ai_response_logs_select on public.ai_response_logs for select to authenticated
  using ( platform.is_platform_admin()
          or platform.has_hotel_role(hotel_id, array['hotel_admin']::public.hotel_member_role[]) );

-- unanswered_questions: hotel_admin/editor manage own hotel; read by members.
create policy unanswered_questions_select on public.unanswered_questions for select to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_membership(hotel_id) );
create policy unanswered_questions_write on public.unanswered_questions for all to authenticated
  using ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) )
  with check ( platform.is_platform_admin() or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) );

-- knowledge_embeddings: platform_admin/service only (internal readiness).
create policy knowledge_embeddings_select on public.knowledge_embeddings for select to authenticated
  using ( platform.is_platform_admin() );
