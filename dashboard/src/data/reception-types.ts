// Safe UI domain models for the Reception / Guests / Stays / Consent workspace.
// These map raw DB rows to human models and intentionally omit sensitive columns
// (stay access_token_hash, push endpoint/keys, raw device/ip metadata) — RLS and
// column grants are the real boundary; these types keep the UI honest.

export type StayStatus = "reserved" | "checked_in" | "checked_out" | "cancelled" | "no_show";
export type RequestPriority = "low" | "normal" | "high" | "urgent";
export type RequestStatus = "new" | "acknowledged" | "in_progress" | "resolved" | "closed" | "cancelled";
export type RequestEventType = "created" | "acknowledged" | "assigned" | "status_change" | "internal_note" | "guest_reply" | "resolved" | "reopened";
export type FeedbackStatus = "new" | "reviewed" | "resolved";
export type DuplicateStatus = "pending" | "confirmed" | "rejected";
export type ConsentState = "granted" | "revoked";

export const STAY_STATUS_LABEL: Record<StayStatus, string> = {
  reserved: "Reserved", checked_in: "In house", checked_out: "Checked out", cancelled: "Cancelled", no_show: "No-show",
};
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  new: "New", acknowledged: "Acknowledged", in_progress: "In progress", resolved: "Resolved", closed: "Closed", cancelled: "Cancelled",
};
export const PRIORITY_LABEL: Record<RequestPriority, string> = {
  low: "Low", normal: "Normal", high: "High", urgent: "Urgent",
};

export interface GuestSummary {
  id: string;
  displayName: string;            // "First Last" or "Guest" when pseudonymized
  preferredLocale: string | null;
  countryCode: string | null;
  pseudonymized: boolean;
  deleted: boolean;
  // latest stay context (optional, joined)
  latestStayId?: string | null;
  roomNumber?: string | null;
  stayStatus?: StayStatus | null;
  arrivalAt?: string | null;
  departureAt?: string | null;
  openRequests?: number;
  hasConsent?: boolean;
}

export interface GuestProfile extends GuestSummary {
  firstName: string | null;
  lastName: string | null;
  email: string | null;           // SENSITIVE — only when role permits
  phone: string | null;           // SENSITIVE
  externalSource: string | null;
  externalId: string | null;
  pseudonymizedAt: string | null;
  createdAt: string;
}

export interface StaySummary {
  id: string;
  status: StayStatus;
  roomId: string | null;
  roomNumber: string | null;
  guestId: string | null;
  guestName: string | null;       // may be first-name-only depending on role/RPC
  arrivalAt: string | null;
  departureAt: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
}

export interface StayDetail extends StaySummary {
  hotelId: string;
  externalSource: string | null;
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestSummary {
  id: string;
  requestType: string;
  title: string;
  status: RequestStatus;
  priority: RequestPriority;
  roomId: string | null;
  roomNumber: string | null;
  stayId: string | null;
  guestId: string | null;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface RequestDetail extends RequestSummary {
  hotelId: string;
  description: string | null;
  guestVisibleResponse: string | null;
  internalNotes: string | null;   // staff-only; never shown in a guest-facing surface
  closedAt: string | null;
  source: string | null;
}

export interface RequestEvent {
  id: string;
  eventType: RequestEventType;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus | null;
  note: string | null;
  isInternal: boolean;
  actorUserId: string | null;
  createdAt: string;
}

export interface ConsentStatusInfo {
  hasGranted: boolean;
  latestConsentId: string | null;
  latestType: string | null;
  latestSignedAt: string | null;
  revoked: boolean;
}

export interface SignedConsent {
  id: string;
  hotelId: string;
  guestId: string;
  stayId: string | null;
  templateId: string | null;
  consentType: string;
  consentVersion: number;
  locale: string;
  textSnapshot: string;
  signedName: string;
  signedAt: string;
  staffUserId: string | null;
  status: ConsentState;
  revokedAt: string | null;
  hasSignatureAsset: boolean;
  hasDocumentAsset: boolean;
}

export interface ConsentTemplate {
  id: string;
  hotelId: string | null;         // null = platform template
  key: string;
  locale: string;
  version: number;
  title: string;
  bodyText: string;
  status: "draft" | "preview" | "published" | "archived";
  active: boolean;
  publishedAt: string | null;
  updatedAt: string;
}

export interface FeedbackSummary {
  id: string;
  rating: number | null;
  category: string | null;
  message: string | null;
  followUpRequested: boolean;
  status: FeedbackStatus;
  assignedTo: string | null;
  stayId: string | null;
  roomId: string | null;
  roomNumber: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface DuplicateSuggestion {
  id: string;
  status: DuplicateStatus;
  matchReason: string | null;
  matchScore: number | null;
  guestId: string;
  candidateGuestId: string;
  guestName: string;              // redacted-friendly display
  candidateName: string;
  createdAt: string;
  reviewedAt: string | null;
}
