// =============================================================
// Gemini API error classification + user-facing messaging
// =============================================================
// Shared by the passport and TM.30 scan server actions so both:
//   1. retry the same set of *transient* failures, and
//   2. surface consistent, non-leaky messages to the user.
//
// The @google/genai ApiError exposes the HTTP status; when it is
// absent (wrapped/network errors) we fall back to matching the
// canonical gRPC status name in the message text.
// =============================================================

export type GeminiErrorKind =
  | "overloaded" // 503 UNAVAILABLE — model temporarily overloaded
  | "rateLimited" // 429 RESOURCE_EXHAUSTED — rate limit / quota
  | "server" // 500/504 INTERNAL / deadline — transient server-side
  | "auth" // 401/403 — missing/invalid API key or permission
  | "badRequest" // 400 INVALID_ARGUMENT — malformed/unsupported input
  | "unknown";

function statusOf(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const e = err as { status?: unknown; statusCode?: unknown; code?: unknown };
    for (const v of [e.status, e.statusCode, e.code]) {
      if (typeof v === "number") return v;
    }
  }
  return undefined;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function classifyGeminiError(err: unknown): GeminiErrorKind {
  const status = statusOf(err);
  const msg = messageOf(err);

  if (status === 503 || /\b503\b|UNAVAILABLE|overloaded|high demand/i.test(msg)) {
    return "overloaded";
  }
  if (status === 429 || /\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(msg)) {
    return "rateLimited";
  }
  if (status === 500 || status === 504 || /\b50[04]\b|INTERNAL|DEADLINE_EXCEEDED|timed out/i.test(msg)) {
    return "server";
  }
  if (status === 401 || status === 403 || /\b40[13]\b|API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) {
    return "auth";
  }
  if (status === 400 || /\b400\b|INVALID_ARGUMENT|FAILED_PRECONDITION/i.test(msg)) {
    return "badRequest";
  }
  return "unknown";
}

// Transient classes are worth a short retry; permanent ones (auth/badRequest)
// will only fail again, so we surface them to the user immediately.
export function isTransientGeminiError(err: unknown): boolean {
  const kind = classifyGeminiError(err);
  return kind === "overloaded" || kind === "rateLimited" || kind === "server";
}

/**
 * Maps an error to a friendly, non-leaky message for the user.
 * `subject` is the noun for the document being read, e.g. "passport"
 * or "TM.30 PDF", used only in the fallback/bad-input messages.
 */
export function friendlyGeminiMessage(err: unknown, subject: string): string {
  switch (classifyGeminiError(err)) {
    case "overloaded":
      return "The AI service is currently busy. Please try again in a moment.";
    case "rateLimited":
      return "The AI service is rate-limited right now. Please wait a moment and try again.";
    case "server":
      return "The AI service had a temporary problem. Please try again in a moment.";
    case "auth":
      return "The AI service rejected the request (API key or permission). Please check the server configuration.";
    case "badRequest":
      return `The ${subject} couldn't be processed. Please try again with a clearer document.`;
    default:
      return `Couldn't read the ${subject}. Please try again with a clearer document.`;
  }
}
