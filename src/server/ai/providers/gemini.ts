import "server-only";

import type { LLMGenerateJsonArgs, LLMProvider } from "@/contracts/ai";
import { fetchWithBackoff } from "@/server/http/fetch-backoff";
import { JSON_RETRY_NUDGE, LLM_BACKOFF, parseModelJson, throwHttpError, withJsonRetry, type ProviderDeps } from "./shared";

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

function extractText(json: GeminiResponse): string {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("").trim();
}

/** Gemini REST provider (free tier). Only used when AI_PROVIDER=gemini. */
export function geminiProvider(apiKey: string, model: string, deps: ProviderDeps = {}): LLMProvider {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  async function call<T>(args: LLMGenerateJsonArgs<T>, nudge: boolean): Promise<T> {
    const res = await fetchWithBackoff(
      url,
      {
        method: "POST",
        // Header, not ?key=, so the key never shows up in URL/access logs.
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: args.system }] },
          contents: [{ role: "user", parts: [{ text: args.prompt + (nudge ? JSON_RETRY_NUDGE : "") }] }],
          generationConfig: {
            temperature: args.temperature ?? 0.2,
            responseMimeType: "application/json",
          },
        }),
      },
      { ...LLM_BACKOFF, ...deps },
    );
    if (!res.ok) return throwHttpError("Gemini", res);
    return parseModelJson("Gemini", extractText((await res.json()) as GeminiResponse), args);
  }

  return {
    name: "gemini",
    model,
    isMock: false,
    generateJson: (args) => withJsonRetry((nudge) => call(args, nudge)),
  };
}
