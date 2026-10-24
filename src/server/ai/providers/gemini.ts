import "server-only";

import type { LLMGenerateJsonArgs, LLMProvider } from "@/contracts/ai";

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

function extractText(json: GeminiResponse): string {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("").trim();
}

/** Gemini REST provider (free tier). Only used when AI_PROVIDER=gemini. */
export function geminiProvider(apiKey: string, model: string): LLMProvider {
  async function call(args: LLMGenerateJsonArgs<unknown>, retry: boolean): Promise<unknown> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.system }] },
        contents: [{ role: "user", parts: [{ text: args.prompt + (retry ? "\n\nRETRY: respond with a single valid JSON object only." : "") }] }],
        generationConfig: {
          temperature: args.temperature ?? 0.2,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini generateContent failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    const text = extractText((await res.json()) as GeminiResponse);
    if (!text) throw new Error("Gemini returned empty content");
    const parsed: unknown = JSON.parse(text);
    return args.schema.parse(parsed);
  }

  return {
    name: "gemini",
    model,
    isMock: false,
    async generateJson<T>(args: LLMGenerateJsonArgs<T>): Promise<T> {
      try {
        return (await call(args as LLMGenerateJsonArgs<unknown>, false)) as T;
      } catch {
        // retry once with a "JSON only" nudge
        return (await call(args as LLMGenerateJsonArgs<unknown>, true)) as T;
      }
    },
  };
}
