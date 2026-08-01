-- ============================================================================
-- AI OLLY Platform 2.0 — Migration Step 7: Pricing
-- ----------------------------------------------------------------------------
-- price_categories + price_items with Pattern A inheritance (platform default ->
-- hotel override), currency/VAT/billing-unit, validity windows, publishing/
-- versioning (content_versions, Step 1), redacted audit, and a deterministic
-- resolved_price_items(hotel) with computed net/gross. Future PMS fields are a
-- nullable jsonb placeholder — NO PMS integration. RLS from row one. aiolly-dev
-- only. Idempotent; rebuildable via `supabase db reset`.
-- ============================================================================

-- billing unit enum; source_type reuses public.service_source_type (platform/hotel/override).
do $$ begin
  if not exists (select 1 from pg_type where typname = 'price_billing_unit') then
    create type public.price_billing_unit as enum
      ('per_night','per_person','per_person_per_night','per_stay','per_item','per_use','per_hour','flat');
  end if;
end $$;

-- ── price_categories (platform default vs hotel scope) ───────────────────────
create table if not exists public.price_categories (
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
  constraint price_categories_key_fmt check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create unique index if not exists price_categories_key_platform on public.price_categories (key) where hotel_id is null;
create unique index if not exists price_categories_key_hotel    on public.price_categories (hotel_id, key) where hotel_id is not null;
create index if not exists price_categories_hotel_idx on public.price_categories (hotel_id);

-- ── price_items ──────────────────────────────────────────────────────────────
create table if not exists public.price_items (
  id                        uuid primary key default gen_random_uuid(),
  hotel_id                  uuid references public.hotels(id) on delete cascade,   -- null = platform default
  category_id               uuid references public.price_categories(id) on delete set null,
  key                       text not null,
  name                      text not null,
  description               text,
  amount                    numeric(12,2) not null,
  currency                  text not null default 'EUR',
  vat_rate                  numeric(5,2) not null default 0,        -- percent, e.g. 25.00
  vat_included              boolean not null default true,          -- is `amount` gross?
  billing_unit              public.price_billing_unit not null default 'per_item',
  status                    public.content_status not null default 'draft',
  active                    boolean not null default true,
  source_type               public.service_source_type not null default 'hotel',  -- derived by trigger
  override_of_price_item_id uuid references public.price_items(id) on delete set null,
  valid_from                timestamptz,
  valid_to                  timestamptz,
  published_at              timestamptz,
  pms_metadata              jsonb,                                  -- future PMS fields (NOT integrated)
  legacy_airtable_record_id text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid,
  updated_by                uuid,
  constraint price_items_key_fmt      check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint price_items_amount_nn    check (amount >= 0),
  constraint price_items_vat_range    check (vat_rate >= 0 and vat_rate <= 100),
  constraint price_items_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint price_items_valid_range  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create unique index if not exists price_items_key_platform on public.price_items (key) where hotel_id is null;
create unique index if not exists price_items_key_hotel    on public.price_items (hotel_id, key) where hotel_id is not null;
create index if not exists price_items_hotel_idx    on public.price_items (hotel_id);
create index if not exists price_items_category_idx on public.price_items (category_id);
create index if not exists price_items_override_idx on public.price_items (override_of_price_item_id);
create index if not exists price_items_live_idx     on public.price_items (hotel_id, status, active);

create trigger trg_price_categories_set_updated_at before update on public.price_categories for each row execute function platform.set_updated_at();
create trigger trg_price_items_set_updated_at      before update on public.price_items      for each row execute function platform.set_updated_at();

-- ── Integrity: derive source_type; validate category/override scope ──────────
create or replace function platform.normalize_price_item()
returns trigger language plpgsql as $$
begin
  new.source_type := case
    when new.hotel_id is null then 'platform'::public.service_source_type
    when new.override_of_price_item_id is not null then 'override'::public.service_source_type
    else 'hotel'::public.service_source_type end;
  return new;
end; $$;
create trigger trg_price_items_normalize before insert or update on public.price_items
  for each row execute function platform.normalize_price_item();

create or replace function platform.check_price_relations()
returns trigger language plpgsql as $$
declare cat_hotel uuid; ov_hotel uuid;
begin
  if new.category_id is not null then
    select hotel_id into cat_hotel from public.price_categories where id = new.category_id;
    if not found then raise exception 'price category % not found', new.category_id using errcode = '23503'; end if;
    if cat_hotel is not null and new.hotel_id is not null and cat_hotel <> new.hotel_id then
      raise exception 'price category % is not in hotel %', new.category_id, new.hotel_id using errcode = '23514';
    end if;
    if new.hotel_id is null and cat_hotel is not null then
      raise exception 'platform-default price must use a platform price category' using errcode = '23514';
    end if;
  end if;
  if new.override_of_price_item_id is not null then
    if new.hotel_id is null then
      raise exception 'a platform-default price cannot be an override' using errcode = '23514';
    end if;
    select hotel_id into ov_hotel from public.price_items where id = new.override_of_price_item_id;
    if ov_hotel is not null then
      raise exception 'override target % must be a platform default price', new.override_of_price_item_id using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
create trigger trg_price_items_relations before insert or update on public.price_items
  for each row execute function platform.check_price_relations();

-- ── Column protection ────────────────────────────────────────────────────────
create or replace function platform.protect_price_category_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or platform.is_platform_admin() then
    return new;
  end if;
  new.hotel_id := old.hotel_id; new.key := old.key;
  new.legacy_airtable_record_id := old.legacy_airtable_record_id; new.created_by := old.created_by;
  return new;
end; $$;
create trigger trg_price_categories_protect before update on public.price_categories
  for each row execute function platform.protect_price_category_columns();

create or replace function platform.protect_price_item_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('service_role','postgres','supabase_admin') or platform.is_platform_admin() then
    return new;
  end if;
  new.hotel_id                  := old.hotel_id;
  new.override_of_price_item_id := old.override_of_price_item_id;
  new.legacy_airtable_record_id := old.legacy_airtable_record_id;
  new.created_by                := old.created_by;
  new.key                       := old.key;
  new.published_at              := old.published_at;
  if new.status = 'published' and old.status is distinct from 'published' then
    raise exception 'direct publish is not allowed; use public.publish_price_item()' using errcode = '42501';
  end if;
  return new;
end; $$;
create trigger trg_price_items_protect before update on public.price_items
  for each row execute function platform.protect_price_item_columns();

-- ── Redacted audit ───────────────────────────────────────────────────────────
create or replace function platform.audit_price_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; act public.audit_action; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  oj := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  if tg_op='INSERT' then act:='create';
  elsif tg_op='DELETE' then act:='delete';
  elsif (nj->>'status')='published' and (oj->>'status') is distinct from 'published' then act:='publish';
  elsif (nj->>'status')='archived'  and (oj->>'status') is distinct from 'archived'  then act:='archive';
  elsif (oj->>'status')='archived'  and (nj->>'status') is distinct from 'archived'  then act:='restore';
  else act:='update';
  end if;
  insert into public.audit_log
    (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state)
  values
    (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'), (oj->>'hotel_id'))::uuid, 'price_item', coalesce((nj->>'id'),(oj->>'id'))::uuid, act,
     case when oj is not null then jsonb_build_object('status',oj->>'status','name',oj->>'name','amount',oj->>'amount','currency',oj->>'currency','active',oj->>'active') end,
     case when nj is not null then jsonb_build_object('status',nj->>'status','name',nj->>'name','amount',nj->>'amount','currency',nj->>'currency','active',nj->>'active') end);
  return coalesce(new, old);
end; $$;
create trigger trg_price_items_audit after insert or update or delete on public.price_items
  for each row execute function platform.audit_price_item();

create or replace function platform.audit_price_category()
returns trigger language plpgsql security definer set search_path = '' as $$
declare nj jsonb; oj jsonb; a_uid uuid;
begin
  a_uid := auth.uid();
  nj := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  oj := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  insert into public.audit_log (actor_user_id, actor_type, hotel_id, entity_type, entity_id, action, before_state, after_state)
  values (a_uid, case when a_uid is not null then 'user'::public.actor_type else 'service'::public.actor_type end,
     coalesce((nj->>'hotel_id'),(oj->>'hotel_id'))::uuid, 'price_category', coalesce((nj->>'id'),(oj->>'id'))::uuid,
     case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete' else 'update' end::public.audit_action,
     case when oj is not null then jsonb_build_object('key',oj->>'key','name',oj->>'name','active',oj->>'active') end,
     case when nj is not null then jsonb_build_object('key',nj->>'key','name',nj->>'name','active',nj->>'active') end);
  return coalesce(new, old);
end; $$;
create trigger trg_price_categories_audit after insert or update or delete on public.price_categories
  for each row execute function platform.audit_price_category();

-- ── Publishing (public RPC; SECURITY DEFINER) ────────────────────────────────
-- platform_admin publishes platform defaults; hotel_admin/editor publish own-hotel
-- prices. Flips status->published, stamps published_at, writes immutable version.
create or replace function public.publish_price_item(p_item uuid, p_change_summary text default null)
returns public.content_versions
language plpgsql volatile security definer set search_path = '' as $$
declare it public.price_items; vnum int; cv public.content_versions;
begin
  select * into it from public.price_items where id = p_item;
  if it.id is null then raise exception 'price_item % not found', p_item using errcode = 'P0002'; end if;
  if not ( platform.is_platform_admin()
           or ( it.hotel_id is not null
                and platform.has_hotel_role(it.hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]) ) ) then
    raise exception 'insufficient privilege to publish price_item %', p_item using errcode = '42501';
  end if;
  select coalesce(max(version_number),0)+1 into vnum
    from public.content_versions where entity_type = 'price_item' and entity_id = p_item;
  update public.price_items set status = 'published', published_at = now(), updated_by = auth.uid()
    where id = p_item returning * into it;
  insert into public.content_versions
    (entity_type, entity_id, version_number, status, snapshot, change_summary, hotel_id, published_at, created_by)
  values ('price_item', p_item, vnum, 'published', to_jsonb(it), p_change_summary, it.hotel_id, now(), auth.uid())
  returning * into cv;
  return cv;
end; $$;
revoke all on function public.publish_price_item(uuid, text) from public;
grant execute on function public.publish_price_item(uuid, text) to authenticated, service_role;

-- ── Resolved pricing (Pattern A; SECURITY INVOKER; computed net/gross) ───────
create or replace function public.resolved_price_items(p_hotel uuid)
returns table (
  price_item_id uuid, source public.service_source_type, category_id uuid, category_key text,
  key text, name text, description text, amount numeric, currency text, vat_rate numeric,
  vat_included boolean, billing_unit public.price_billing_unit, net_amount numeric, gross_amount numeric,
  valid_from timestamptz, valid_to timestamptz, published_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  with live as (
    select p.* from public.price_items p
    where p.status = 'published' and p.active
      and (p.valid_from is null or p.valid_from <= now())
      and (p.valid_to   is null or p.valid_to   >= now())
      and (p.hotel_id = p_hotel or p.hotel_id is null)
  ),
  overridden as (
    select override_of_price_item_id as def_id from live
    where hotel_id = p_hotel and override_of_price_item_id is not null
  ),
  chosen as (
    select l.* from live l
    where l.hotel_id = p_hotel
       or ( l.hotel_id is null and l.id not in (select def_id from overridden) )
  )
  select
    c.id, c.source_type, c.category_id, pc.key,
    c.key, c.name, c.description, c.amount, c.currency, c.vat_rate, c.vat_included, c.billing_unit,
    round(case when c.vat_included then c.amount / (1 + c.vat_rate/100) else c.amount end, 2)          as net_amount,
    round(case when c.vat_included then c.amount else c.amount * (1 + c.vat_rate/100) end, 2)          as gross_amount,
    c.valid_from, c.valid_to, c.published_at
  from chosen c
  left join public.price_categories pc on pc.id = c.category_id
  order by pc.sort_order nulls last, c.name;
$$;
revoke all on function public.resolved_price_items(uuid) from public;
grant execute on function public.resolved_price_items(uuid) to authenticated, service_role;

-- ── RLS + GRANTS (fail-closed; REVOKE ALL then precise GRANT) ─────────────────
alter table public.price_categories enable row level security;
alter table public.price_items      enable row level security;

revoke all on public.price_categories, public.price_items from public, anon, authenticated, service_role;

grant select, insert, update on public.price_categories to service_role, authenticated;
grant select, insert, update on public.price_items      to service_role, authenticated;

-- PRICE_CATEGORIES: platform scope only by platform_admin; hotel scope by hotel_admin/editor.
create policy price_categories_select on public.price_categories for select to authenticated
  using ( platform.is_platform_admin()
          or (hotel_id is not null and platform.has_hotel_membership(hotel_id))
          or (hotel_id is null and active and platform.has_any_membership()) );
create policy price_categories_ins on public.price_categories for insert to authenticated
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin()
                     or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) );
create policy price_categories_upd on public.price_categories for update to authenticated
  using ( (hotel_id is null and platform.is_platform_admin())
          or (hotel_id is not null and (platform.is_platform_admin()
                or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) )
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin()
                     or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) );

-- PRICE_ITEMS: authors see all statuses of their scope; members see published;
-- published platform defaults visible to any member. No hard delete (archive).
create policy price_items_select on public.price_items for select to authenticated
  using ( platform.is_platform_admin()
          or (hotel_id is not null
              and platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))
          or (hotel_id is not null and status = 'published' and platform.has_hotel_membership(hotel_id))
          or (hotel_id is null and status = 'published' and active and platform.has_any_membership()) );
create policy price_items_ins on public.price_items for insert to authenticated
  with check ( (hotel_id is null and platform.is_platform_admin())
               or (hotel_id is not null and (platform.is_platform_admin()
                     or platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[]))) );
create policy price_items_upd on public.price_items for update to authenticated
  using ( platform.is_platform_admin()
          or (hotel_id is not null
              and platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[])) )
  with check ( platform.is_platform_admin()
               or (hotel_id is not null
                   and platform.has_hotel_role(hotel_id, array['hotel_admin','editor']::public.hotel_member_role[])) );
