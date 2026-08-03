// ============================================================================
// Brevo integration boundary — server-side ONLY (Sprint 7).
// ----------------------------------------------------------------------------
// A typed seam for a FUTURE Brevo delivery integration. Nothing here calls Brevo,
// sends email, contacts webhook endpoints, or reads real credentials. In dev every
// method returns an explicit { ok:false, reason:"not_configured" } — never a fake
// success. A real implementation would live behind this same interface and be
// wired only when BREVO_API_KEY (server env) is present and delivery is approved.
// ============================================================================

export interface BrevoResult<T = unknown> {
  ok: boolean;
  reason?: "not_configured" | "disabled_in_dev" | "error";
  message?: string;
  data?: T;
}

export interface BrevoAdapter {
  isConfigured(): boolean;
  syncSubscriber(input: { hotelId: string; subscriberId: string }): Promise<BrevoResult>;
  createOrUpdateCampaign(input: { hotelId: string; campaignId: string }): Promise<BrevoResult>;
  sendTest(input: { campaignId: string; toStaffEmail: string }): Promise<BrevoResult>;
  scheduleCampaign(input: { campaignId: string; scheduledAt: string }): Promise<BrevoResult>;
  cancelCampaign(input: { campaignId: string }): Promise<BrevoResult>;
  processWebhook(input: { rawEventId: string; eventType: string; payload: unknown }): Promise<BrevoResult>;
  syncStats(input: { campaignId: string }): Promise<BrevoResult>;
}

/** Dev adapter — refuses every outbound action. No network, no email, no fakes. */
class NotConfiguredBrevoAdapter implements BrevoAdapter {
  isConfigured() { return false; }
  private no(): BrevoResult { return { ok: false, reason: "not_configured", message: "Brevo is not configured in this environment. No email is sent and no external call is made." }; }
  async syncSubscriber() { return this.no(); }
  async createOrUpdateCampaign() { return this.no(); }
  async sendTest() { return this.no(); }
  async scheduleCampaign() { return this.no(); }
  async cancelCampaign() { return this.no(); }
  async processWebhook() { return this.no(); }
  async syncStats() { return this.no(); }
}

/** Returns the active adapter. Only ever the not-configured one in this sprint —
 *  a real adapter is intentionally NOT wired (no credentials, no sending). */
export function getBrevoAdapter(): BrevoAdapter {
  // A future gate: if (process.env.BREVO_API_KEY && process.env.BREVO_SEND_ENABLED === "true") return new RealBrevoAdapter();
  return new NotConfiguredBrevoAdapter();
}

/** Redact a provider webhook payload to a short, PII/secret-free summary line. */
export function redactWebhookPayload(eventType: string | null, payload: any): string {
  const t = eventType ?? "event";
  const email = typeof payload?.email === "string" ? maskEmail(payload.email) : null;
  const msg = typeof payload?.["message-id"] === "string" ? "msg ✓" : null;
  return [t, email, msg].filter(Boolean).join(" · ") || t;
}
function maskEmail(e: string) { const [u, d] = e.split("@"); return d ? `${u.slice(0, 2)}${"•".repeat(Math.max(1, u.length - 2))}@${d}` : "•••"; }
