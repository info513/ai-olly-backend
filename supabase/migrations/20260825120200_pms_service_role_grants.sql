-- Additive (Phase R2): the PMS sync/webhook engine runs server-side as service_role
-- (bypasses RLS). Grant it DML on the integration tables so initial sync, reconciliation
-- and webhook ingestion can write events/runs/mappings/config. anon stays fully revoked;
-- authenticated remains gated by the RLS policies from 20260825120000.
grant select, insert, update, delete on public.hotel_integrations       to service_role;
grant select, insert, update, delete on public.external_entity_mappings to service_role;
grant select, insert, update, delete on public.integration_events       to service_role;
grant select, insert, update, delete on public.sync_runs                to service_role;
