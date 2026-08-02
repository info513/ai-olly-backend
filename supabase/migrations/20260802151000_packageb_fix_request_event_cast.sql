-- ============================================================================
-- Fix: cast request-event type in the append-only history trigger.
-- ----------------------------------------------------------------------------
-- FINDING (surfaced in Package B): platform.log_request_event() built event_type
-- via a CASE expression that yields `text`, but request_events.event_type is the
-- enum public.request_event_type → "column event_type is of type
-- request_event_type but expression is of type text" on every status change, so
-- status-change history was never appended. Add an explicit enum cast.
-- ============================================================================

create or replace function platform.log_request_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a_uid uuid;
begin
  a_uid := auth.uid();
  if tg_op = 'INSERT' then
    insert into public.request_events (request_id, hotel_id, event_type, to_status, actor_user_id)
    values (new.id, new.hotel_id, 'created', new.status, a_uid);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.request_events (request_id, hotel_id, event_type, from_status, to_status, actor_user_id)
    values (new.id, new.hotel_id,
            (case when new.status = 'resolved' then 'resolved'
                  when new.status = 'acknowledged' then 'acknowledged'
                  else 'status_change' end)::public.request_event_type,
            old.status, new.status, a_uid);
  end if;
  return coalesce(new, old);
end; $$;
