import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fetchWithBackoff, parseRetryAfter } from "@/server/http/fetch-backoff";
import { geminiProvider } from "../providers/gemini";
import { ollamaProvider } from "../providers/ollama";
import { ProviderHttpError } from "../providers/shared";

const Schema = z.object({ answer: z.string() });
const args = { system: "sys", prompt: "question", schema: Schema, task: "test_task" };

interface Call {
  url: string;
  init?: RequestInit;
}

function stubFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch");
    return next();
  };
  return { calls, fetchImpl };
}

function sleepRecorder() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

const gemini = (text: string) => () =>
  Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
const ollama = (content: string) => () => Response.json({ message: { content } });
const status = (code: number, headers: Record<string, string> = {}) => () =>
  new Response("upstream says no", { status: code, headers });

function promptOf(call: Call): string {
  return JSON.stringify(JSON.parse(String(call.init?.body)));
}

describe("gemini provider", () => {
  it("sends the key in x-goog-api-key, never the URL", async () => {
    const { calls, fetchImpl } = stubFetch([gemini('{"answer":"ok"}')]);
    const p = geminiProvider("secret-key", "gemini-2.0-flash", { fetchImpl });
    await expect(p.generateJson(args)).resolves.toEqual({ answer: "ok" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).not.toContain("secret-key");
    expect(calls[0].url).not.toContain("key=");
    expect(new Headers(calls[0].init?.headers).get("x-goog-api-key")).toBe("secret-key");
  });

  it("retries once with the JSON nudge on invalid JSON", async () => {
    const { calls, fetchImpl } = stubFetch([gemini("not json"), gemini('{"answer":"fixed"}')]);
    const p = geminiProvider("k", "m", { fetchImpl });
    await expect(p.generateJson(args)).resolves.toEqual({ answer: "fixed" });
    expect(calls).toHaveLength(2);
    expect(promptOf(calls[0])).not.toContain("RETRY");
    expect(promptOf(calls[1])).toContain("RETRY");
  });

  it("retries once with the nudge on a schema mismatch, then gives up", async () => {
    const { calls, fetchImpl } = stubFetch([gemini('{"wrong":1}'), gemini('{"wrong":2}')]);
    const p = geminiProvider("k", "m", { fetchImpl });
    await expect(p.generateJson(args)).rejects.toThrow(/schema/);
    expect(calls).toHaveLength(2);
  });

  it("backs off on 429 honouring Retry-After, without the nudge", async () => {
    const { calls, fetchImpl } = stubFetch([status(429, { "retry-after": "2" }), gemini('{"answer":"ok"}')]);
    const { waits, sleep } = sleepRecorder();
    const p = geminiProvider("k", "m", { fetchImpl, sleep });
    await expect(p.generateJson(args)).resolves.toEqual({ answer: "ok" });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
    expect(promptOf(calls[1])).not.toContain("RETRY");
  });

  it("backs off exponentially on 5xx and fails after bounded attempts", async () => {
    const { calls, fetchImpl } = stubFetch([status(503), status(502), status(500)]);
    const { waits, sleep } = sleepRecorder();
    const p = geminiProvider("k", "m", { fetchImpl, sleep });
    const err = await p.generateJson(args).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect((err as ProviderHttpError).status).toBe(500);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([1000, 2000]);
  });

  it("fails fast on other 4xx", async () => {
    const { calls, fetchImpl } = stubFetch([status(400)]);
    const { waits, sleep } = sleepRecorder();
    const p = geminiProvider("k", "m", { fetchImpl, sleep });
    await expect(p.generateJson(args)).rejects.toBeInstanceOf(ProviderHttpError);
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });
});

describe("ollama provider", () => {
  it("retries with the nudge on bad JSON only", async () => {
    const { calls, fetchImpl } = stubFetch([ollama("{oops"), ollama('{"answer":"ok"}')]);
    const p = ollamaProvider("http://127.0.0.1:11434/", "llama3", { fetchImpl });
    await expect(p.generateJson(args)).resolves.toEqual({ answer: "ok" });
    expect(calls[0].url).toBe("http://127.0.0.1:11434/api/chat");
    expect(promptOf(calls[1])).toContain("RETRY");
  });

  it("fails fast on 404 (model not pulled)", async () => {
    const { calls, fetchImpl } = stubFetch([status(404)]);
    const p = ollamaProvider("http://x", "missing", { fetchImpl });
    await expect(p.generateJson(args)).rejects.toThrow(/HTTP 404/);
    expect(calls).toHaveLength(1);
  });

  it("retries a 503 then succeeds", async () => {
    const { calls, fetchImpl } = stubFetch([status(503), ollama('{"answer":"ok"}')]);
    const { sleep } = sleepRecorder();
    const p = ollamaProvider("http://x", "m", { fetchImpl, sleep });
    await expect(p.generateJson(args)).resolves.toEqual({ answer: "ok" });
    expect(calls).toHaveLength(2);
  });
});

describe("fetchWithBackoff", () => {
  it("retries network errors but not timeouts when retryOnTimeout=false", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    let n = 0;
    const fetchImpl = async () => {
      n++;
      throw timeout;
    };
    await expect(
      fetchWithBackoff("http://x", {}, { fetchImpl, retryOnTimeout: false, sleep: async () => undefined }),
    ).rejects.toBe(timeout);
    expect(n).toBe(1);
  });

  it("caps Retry-After", async () => {
    const { fetchImpl } = stubFetch([status(429, { "retry-after": "3600" }), () => new Response("ok")]);
    const { waits, sleep } = sleepRecorder();
    const res = await fetchWithBackoff("http://x", {}, { fetchImpl, sleep, maxRetryAfterMs: 5000 });
    expect(res.ok).toBe(true);
    expect(waits).toEqual([5000]);
  });

  it("parses Retry-After seconds and HTTP dates", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("garbage")).toBeNull();
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:10 GMT", now)).toBe(10_000);
  });
});
