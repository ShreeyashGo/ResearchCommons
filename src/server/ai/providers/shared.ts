import "server-only";

import type { LLMGenerateJsonArgs } from "@/contracts/ai";
import type { BackoffOptions } from "@/server/http/fetch-backoff";

export const JSON_RETRY_NUDGE = "\n\nRETRY: respond with a single valid JSON object only.";

/** Upper bound on one LLM request; slow generations are not retried. */
export const LLM_TIMEOUT_MS = 60_000;

export const LLM_BACKOFF: BackoffOptions = {
  maxAttempts: 3,
  timeoutMs: LLM_TIMEOUT_MS,
  initialDelayMs: 1_000,
  maxRetryAfterMs: 20_000,
  retryOnTimeout: false,
};

/** The model answered, but not with JSON that matches the schema. */
export class ProviderOutputError extends Error {}

/** Non-retryable HTTP failure from the provider (or retries exhausted). */
export class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    body: string,
  ) {
    super(`${provider} request failed: HTTP ${status} ${body.slice(0, 300)}`);
  }
}

export async function throwHttpError(provider: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new ProviderHttpError(provider, res.status, body);
}

export function parseModelJson<T>(provider: string, text: string, args: LLMGenerateJsonArgs<T>): T {
  if (!text) throw new ProviderOutputError(`${provider} returned empty content`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProviderOutputError(`${provider} returned invalid JSON`);
  }
  const result = args.schema.safeParse(parsed);
  if (!result.success) throw new ProviderOutputError(`${provider} output failed ${args.task} schema`);
  return result.data;
}

/** One attempt, plus a single "JSON only" retry when the output (not the transport) was bad. */
export async function withJsonRetry<T>(call: (nudge: boolean) => Promise<T>): Promise<T> {
  try {
    return await call(false);
  } catch (err) {
    if (!(err instanceof ProviderOutputError)) throw err;
    return call(true);
  }
}

export interface ProviderDeps {
  fetchImpl?: BackoffOptions["fetchImpl"];
  sleep?: BackoffOptions["sleep"];
}
