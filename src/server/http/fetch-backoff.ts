import "server-only";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface BackoffOptions {
  fetchImpl?: FetchLike;
  /** Total attempts including the first one. */
  maxAttempts?: number;
  /** Per-attempt timeout; ignored when init.signal is set. */
  timeoutMs?: number;
  initialDelayMs?: number;
  /** Upper bound on a server-requested Retry-After wait. */
  maxRetryAfterMs?: number;
  /** Retry when a per-attempt timeout fires (default true). */
  retryOnTimeout?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Retry-After as milliseconds (delta-seconds or HTTP-date); null when absent/invalid. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * fetch with bounded retries on network errors and 429/5xx, honouring
 * Retry-After. Other responses (including non-retryable 4xx) are returned to
 * the caller unchanged so it can fail fast with its own error.
 */
export async function fetchWithBackoff(url: string, init: RequestInit = {}, opts: BackoffOptions = {}): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxAttempts = opts.maxAttempts ?? 4;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRetryAfterMs = opts.maxRetryAfterMs ?? 15_000;
  const sleep = opts.sleep ?? defaultSleep;
  let delay = opts.initialDelayMs ?? 500;

  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      if (attempt >= maxAttempts || init.signal?.aborted || (timedOut && opts.retryOnTimeout === false)) throw err;
      await sleep(delay);
      delay *= 2;
      continue;
    }
    if (res.ok || !isRetryableStatus(res.status) || attempt >= maxAttempts) return res;
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    await res.body?.cancel().catch(() => undefined);
    await sleep(retryAfter !== null && retryAfter > 0 ? Math.min(retryAfter, maxRetryAfterMs) : delay);
    delay *= 2;
  }
}
