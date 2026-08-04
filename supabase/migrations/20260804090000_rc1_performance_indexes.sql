-- ============================================================================
-- 20260804090000_rc1_performance_indexes.sql
-- RC1 Cluster 3 (H3 + M1/M2). Forward-only, additive. No table/RLS/column change.
-- Adds: (1) covering indexes for every unindexed foreign-key column (avoids
-- seq-scan on parent DELETE + speeds joins), (2) composite indexes matching the
-- hot dashboard/AI query paths, (3) partial indexes on legacy_airtable_record_id
-- backing idempotent migration upserts. Plain CREATE INDEX IF NOT EXISTS keeps the
-- migration transaction-safe + idempotent; on a large PRODUCTION table these should
-- be applied with CREATE INDEX CONCURRENTLY (outside a txn) to avoid write locks.
-- ============================================================================

-- (1) Foreign-key covering indexes ------------------------------------------------
create index if not exists idx_ai_response_logs_room_id on public.ai_response_logs (room_id);
create index if not exists idx_asset_usages_hotel_id on public.asset_usages (hotel_id);
create index if not exists idx_consents_stay_id on public.consents (stay_id);
create index if not exists idx_consents_template_id on public.consents (template_id);
create index if not exists idx_content_versions_restored_from_version_id on public.content_versions (restored_from_version_id);
create index if not exists idx_feedback_room_id on public.feedback (room_id);
create index if not exists idx_feedback_stay_id on public.feedback (stay_id);
create index if not exists idx_guest_duplicate_suggestions_candidate_guest_id on public.guest_duplicate_suggestions (candidate_guest_id);
create index if not exists idx_guest_duplicate_suggestions_guest_id on public.guest_duplicate_suggestions (guest_id);
create index if not exists idx_guest_requests_guest_id on public.guest_requests (guest_id);
create index if not exists idx_guest_requests_room_id on public.guest_requests (room_id);
create index if not exists idx_hotel_event_settings_event_id on public.hotel_event_settings (event_id);
create index if not exists idx_hotel_poi_settings_poi_id on public.hotel_poi_settings (poi_id);
create index if not exists idx_hotel_route_settings_route_id on public.hotel_route_settings (route_id);
create index if not exists idx_hotel_service_settings_category_override_id on public.hotel_service_settings (category_override_id);
create index if not exists idx_hotel_whisper_settings_whisper_id on public.hotel_whisper_settings (whisper_id);
create index if not exists idx_knowledge_aliases_hotel_id on public.knowledge_aliases (hotel_id);
create index if not exists idx_knowledge_articles_category_id on public.knowledge_articles (category_id);
create index if not exists idx_knowledge_articles_override_of_article_id on public.knowledge_articles (override_of_article_id);
create index if not exists idx_newsletter_campaign_recipients_hotel_id on public.newsletter_campaign_recipients (hotel_id);
create index if not exists idx_newsletter_campaign_recipients_subscriber_id on public.newsletter_campaign_recipients (subscriber_id);
create index if not exists idx_newsletter_campaigns_segment_id on public.newsletter_campaigns (segment_id);
create index if not exists idx_newsletter_campaigns_template_id on public.newsletter_campaigns (template_id);
create index if not exists idx_newsletter_events_hotel_id on public.newsletter_events (hotel_id);
create index if not exists idx_newsletter_events_recipient_id on public.newsletter_events (recipient_id);
create index if not exists idx_newsletter_events_subscriber_id on public.newsletter_events (subscriber_id);
create index if not exists idx_newsletter_segment_members_subscriber_id on public.newsletter_segment_members (subscriber_id);
create index if not exists idx_newsletter_subscribers_consent_id on public.newsletter_subscribers (consent_id);
create index if not exists idx_newsletter_subscribers_guest_id on public.newsletter_subscribers (guest_id);
create index if not exists idx_newsletter_templates_header_asset_id on public.newsletter_templates (header_asset_id);
create index if not exists idx_newsletter_webhook_events_hotel_id on public.newsletter_webhook_events (hotel_id);
create index if not exists idx_push_subscriptions_stay_id on public.push_subscriptions (stay_id);
create index if not exists idx_request_events_hotel_id on public.request_events (hotel_id);
create index if not exists idx_unanswered_questions_resolution_article_id on public.unanswered_questions (resolution_article_id);
create index if not exists idx_unanswered_questions_room_id on public.unanswered_questions (room_id);

-- (2) Composite / partial indexes for hot query paths -----------------------------
create index if not exists idx_guest_requests_hotel_status_created on public.guest_requests (hotel_id, status, created_at desc);
create index if not exists idx_knowledge_articles_hotel_status_ai on public.knowledge_articles (hotel_id, status, available_to_ai);
create index if not exists idx_stays_hotel_status_arrival on public.stays (hotel_id, status, arrival_at);
create index if not exists idx_consents_hotel_stay on public.consents (hotel_id, stay_id);
create index if not exists idx_assets_hotel_active on public.assets (hotel_id) where deleted_at is null;

-- (3) legacy_airtable_record_id upsert lookups (partial) --------------------------
create index if not exists idx_assets_legacy on public.assets (legacy_airtable_record_id) where legacy_airtable_record_id is not null;
create index if not exists idx_destination_events_legacy on public.destination_events (legacy_airtable_record_id) where legacy_airtable_record_id is not null;
create index if not exists idx_destination_pois_legacy on public.destination_pois (legacy_airtable_record_id) where legacy_airtable_record_id is not null;
create index if not exists idx_destination_routes_legacy on public.destination_routes (legacy_airtable_record_id) where legacy_airtable_record_id is not null;
create index if not exists idx_destination_whispers_legacy on public.destination_whispers (legacy_airtable_record_id) where legacy_airtable_record_id is not null;
create index if not exists idx_hotel_services_legacy on public.hotel_services (legacy_airtable_record_id) where legacy_airtable_record_id is not null;
create index if not exists idx_knowledge_articles_legacy on public.knowledge_articles (legacy_airtable_record_id) where legacy_airtable_record_id is not null;
create index if not exists idx_knowledge_categories_legacy on public.knowledge_categories (legacy_airtable_record_id) where legacy_airtable_record_id is not null;
create index if not exists idx_price_categories_legacy on public.price_categories (legacy_airtable_record_id) where legacy_airtable_record_id is not null;
create index if not exists idx_price_items_legacy on public.price_items (legacy_airtable_record_id) where legacy_airtable_record_id is not null;
create index if not exists idx_room_types_legacy on public.room_types (legacy_airtable_record_id) where legacy_airtable_record_id is not null;
create index if not exists idx_rooms_legacy on public.rooms (legacy_airtable_record_id) where legacy_airtable_record_id is not null;
create index if not exists idx_service_categories_legacy on public.service_categories (legacy_airtable_record_id) where legacy_airtable_record_id is not null;
create index if not exists idx_hotels_legacy on public.hotels (legacy_airtable_id) where legacy_airtable_id is not null;
