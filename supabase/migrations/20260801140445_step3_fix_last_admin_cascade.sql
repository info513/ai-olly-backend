-- ============================================================================
-- Fix: protect_last_hotel_admin blocked legitimate CASCADE deletes.
-- ----------------------------------------------------------------------------
-- FINDING (surfaced in Step 3): deleting a hotel cascades its hotel_memberships,
-- which fired protect_last_hotel_admin and RAISED ("cannot remove the last active
-- hotel_admin"), making hotels undeletable (and dev cleanup impossible).
--
-- The guard is an application-level safeguard for DASHBOARD hotel_admins. It must
-- NOT block owner/superuser operations (migrations, cascade from hotel deletion,
-- maintenance/cleanup). We exempt `postgres`/`supabase_admin` ONLY. `service_role`
-- remains subject to the guard (Step 2 assertion preserved), and `authenticated`
-- hotel_admins still cannot demote/remove the last active hotel_admin.
-- ============================================================================

create or replace function platform.protect_last_hotel_admin()
returns trigger language plpgsql as $$
declare remaining int;
begin
  -- Owner/superuser (migrations, cascade deletes, maintenance) bypass the guard.
  if current_user in ('postgres','supabase_admin') then
    return coalesce(new, old);
  end if;
  if (tg_op = 'DELETE' and old.role = 'hotel_admin' and old.status = 'active')
     or (tg_op = 'UPDATE' and old.role = 'hotel_admin' and old.status = 'active'
         and (new.role <> 'hotel_admin' or new.status <> 'active')) then
    select count(*) into remaining
      from public.hotel_memberships
      where hotel_id = old.hotel_id and role = 'hotel_admin' and status = 'active'
        and id <> old.id;
    if remaining = 0 then
      raise exception 'Cannot remove the last active hotel_admin for hotel %', old.hotel_id
        using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end; $$;
