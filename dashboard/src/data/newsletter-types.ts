import type { BlockBody, ContentStatus } from "./types";

export type SubscriberStatus = "pending" | "subscribed" | "unsubscribed" | "bounced" | "complained" | "suppressed";
export type CampaignStatus = "draft" | "preview" | "scheduled" | "sending" | "sent" | "cancelled" | "failed";
export type NewsletterEventType = "sent" | "delivered" | "opened" | "clicked" | "bounced" | "unsubscribed" | "complained" | "deferred";
export type SegmentType = "static" | "rule";
export type ConsentState = "active" | "revoked" | "missing";

export const SUBSCRIBER_STATUS_LABEL: Record<SubscriberStatus, string> = {
  pending: "Pending", subscribed: "Subscribed", unsubscribed: "Unsubscribed", bounced: "Bounced", complained: "Complained", suppressed: "Suppressed",
};
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft", preview: "Preview", scheduled: "Scheduled", sending: "Sending", sent: "Sent", cancelled: "Cancelled", failed: "Failed",
};

export interface Subscriber {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  locale: string | null;
  countryCode: string | null;
  status: SubscriberStatus;
  source: string | null;
  subscribedAt: string | null;
  unsubscribedAt: string | null;
  consentId: string | null;
  consentState: ConsentState;      // derived (state only, no PII)
  brevoContactId: string | null;   // provider sync marker
  tags: string[];
  guestId: string | null;
  createdAt: string;
}

export interface SegmentRuleCondition {
  field: "locale" | "country_code" | "source" | "status" | "tag";
  op: "eq" | "in";
  value: string | string[];
}
export interface SegmentRules {
  match: "all" | "any";
  conditions: SegmentRuleCondition[];
}

export interface Segment {
  id: string;
  key: string;
  name: string;
  type: SegmentType;
  rules: SegmentRules | null;
  active: boolean;
  memberCount?: number;
  createdAt: string;
}

export interface AudienceRow { subscriberId: string; email: string; locale: string | null; }
export interface AudiencePreview {
  eligible: number;
  sample: AudienceRow[];
  localeSplit: { locale: string; count: number }[];
}

export interface NewsletterTemplate {
  id: string;
  hotelId: string | null;          // null = platform default
  key: string;
  name: string;
  subject: string;
  previewText: string | null;
  content: BlockBody | null;
  locale: string;
  status: ContentStatus;
  headerAssetId: string | null;
  publishedAt: string | null;
  publishedSnapshot: Record<string, any> | null;
  updatedAt: string;
}

export interface TemplateVersion {
  id: string;
  versionNumber: number;
  status: ContentStatus;
  changeSummary: string | null;
  publishedAt: string | null;
  createdAt: string;
  snapshot: Record<string, any>;
}

export interface Campaign {
  id: string;
  hotelId: string;
  name: string;
  templateId: string | null;
  segmentId: string | null;
  subjectSnapshot: string | null;
  previewTextSnapshot: string | null;
  contentSnapshot: BlockBody | null;
  segmentSnapshot: Record<string, any> | null;
  status: CampaignStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  brevoCampaignId: string | null;
  totals: { recipients: number; delivered: number; opened: number; clicked: number; bounced: number; unsubscribed: number };
  createdAt: string;
  templateName?: string | null;
  segmentName?: string | null;
}

export interface CampaignRecipient {
  id: string;
  subscriberId: string | null;
  deliveryStatus: NewsletterEventType | null;
  errorCode: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  bouncedAt: string | null;
  unsubscribedAt: string | null;
}

export interface NewsletterEvent {
  id: string;
  eventType: NewsletterEventType;
  occurredAt: string;
  subscriberId: string | null;
  recipientId: string | null;
}

export interface WebhookEvent {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string | null;
  processedAt: string | null;
  createdAt: string;
  summary: string;                 // redacted, human summary — never the raw payload
}

export interface NewsletterSummary {
  activeSubscribers: number;
  validConsent: number;
  unsubscribedSuppressed: number;
  consentMissing: number;
  draftCampaigns: number;
  scheduledCampaigns: number;
  lastCampaign: Campaign | null;
  totalSubscribers: number;
}
