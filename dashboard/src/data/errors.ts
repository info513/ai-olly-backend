/**
 * Central error humanizer — the UI never shows a raw Supabase/Postgres dump
 * (Design System §13 / UX Bible §18). Maps known error codes/messages to calm,
 * human sentences.
 */
export function humanizeError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const msg = e?.message ?? "";
  const code = e?.code ?? "";

  if (/critical/i.test(msg)) return "This is critical content — please acknowledge before publishing.";
  if (code === "42501" || /insufficient privilege|permission denied|row-level security|violates row-level/i.test(msg))
    return "You don’t have permission to do that here.";
  if (code === "23505" || /duplicate key|already exists/i.test(msg)) return "That already exists — try a different name or key.";
  if (code === "23514" || /violates check constraint|body_valid/i.test(msg)) return "Some fields aren’t valid yet — please review and try again.";
  if (/direct publish is not allowed/i.test(msg)) return "Use the Publish button to publish this content.";
  if (/not found/i.test(msg)) return "We couldn’t find that item — it may have been changed.";
  if (/network|fetch|Failed to fetch/i.test(msg)) return "Connection problem — check your network and retry.";
  return "Something went wrong. Please try again.";
}
