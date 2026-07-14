import {
  MAX_TRACKED_IPS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
} from "./limits";

/**
 * Per-IP rate limiting.
 *
 * Every route here spends real money on someone else's API. Without a limit, a
 * single client — a bad actor, or an honest bug in a retry loop — can run up the
 * bill as fast as the network allows. The input caps bound the cost of *one*
 * request; this bounds the number of them.
 *
 * ⚠️ KNOWN LIMITATION — in-memory, like the vector store.
 *
 * The counters live in one server process, so on serverless each instance keeps
 * its own tally and the effective limit is (instances × RATE_LIMIT_MAX). It also
 * resets on redeploy. This is a real weakness, not a nitpick: it makes the limit
 * a speed bump, not a wall. Right for a demo (no infrastructure, no latency),
 * wrong for production, where this belongs in Redis or an edge limiter so every
 * instance shares one counter.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  /** Requests left in the current window. */
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
};

/**
 * Make room when the map is full.
 *
 * Sweeps *expired* windows first — they are dead weight and cost nothing to
 * drop. Only if none are expired does it evict the oldest live entry.
 *
 * The previous version just deleted the first key in insertion order, and that
 * was a limit bypass rather than untidiness: `Map.set()` on an existing key does
 * NOT move it to the end, so a caller whose window kept resetting held its
 * original early position forever and was the *first* one evicted — while
 * thousands of stale, idle entries sat ahead of it. Eviction resets a caller's
 * count to zero, so the limiter was preferentially forgetting its heaviest user.
 */
function makeRoom(now: number): void {
  if (windows.size < MAX_TRACKED_IPS) return;

  for (const [key, window] of windows) {
    if (now >= window.resetAt) windows.delete(key);
  }
  if (windows.size < MAX_TRACKED_IPS) return;

  // Everything is live — drop the oldest. Because every write path deletes
  // before setting (below), insertion order really does track recency now.
  const oldest = windows.keys().next().value;
  if (oldest !== undefined) windows.delete(oldest);
}

/** Write a window such that insertion order stays a true recency order. */
function touch(key: string, window: Window): void {
  windows.delete(key);
  windows.set(key, window);
}

/**
 * A fixed-window counter: N requests per window, per key.
 *
 * Fixed windows allow a burst across a boundary (N at the end of one window, N
 * at the start of the next). A sliding window or token bucket smooths that out.
 * For protecting a wallet rather than a latency SLO, the simpler thing is enough
 * — and being able to say why it is enough matters more than the extra code.
 */
export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    makeRoom(now);
    touch(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return {
      allowed: true,
      limit: RATE_LIMIT_MAX,
      remaining: RATE_LIMIT_MAX - 1,
      retryAfter: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    };
  }

  const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  if (existing.count >= RATE_LIMIT_MAX) {
    return { allowed: false, limit: RATE_LIMIT_MAX, remaining: 0, retryAfter };
  }

  touch(key, { count: existing.count + 1, resetAt: existing.resetAt });
  return {
    allowed: true,
    limit: RATE_LIMIT_MAX,
    remaining: RATE_LIMIT_MAX - (existing.count + 1),
    retryAfter,
  };
}

/**
 * Identify the caller.
 *
 * Behind a proxy the socket address is the proxy's, so the client IP arrives in
 * `x-forwarded-for` (first entry). That header is client-supplied and trivially
 * spoofed — on Vercel the platform overwrites it, which is what makes it safe to
 * trust *there*. Anywhere the header is not set by infrastructure you control,
 * this is defeatable, and it is worth knowing that rather than assuming the
 * limiter is stronger than it is.
 *
 * Returns null when no client identity is available — which is the normal case
 * in local dev. Collapsing those callers into one shared "unknown" bucket (the
 * previous behaviour) meant two people on the same host would 429 *each other*,
 * since a single document workflow is ~5 requests against a budget of 20.
 */
export function clientKey(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
}

/** Headers that let a well-behaved client back off before it is rejected. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "Retry-After": String(result.retryAfter),
  };
}

/** A 429 carrying the headers a client needs to retry correctly. */
export function rateLimitResponse(result: RateLimitResult): Response {
  return Response.json(
    {
      error: `Too many requests. Try again in ${result.retryAfter} second${result.retryAfter === 1 ? "" : "s"}.`,
    },
    { status: 429, headers: rateLimitHeaders(result) },
  );
}
