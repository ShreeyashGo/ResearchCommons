import "server-only";

import type { LLMGenerateJsonArgs, LLMProvider } from "@/contracts/ai";

interface OllamaChatResponse {
  message?: { content?: string };
}

/** Local Ollama provider (http://127.0.0.1:11434 by default). */
export function ollamaProvider(baseUrl: string, model: string): LLMProvider {
  const base = baseUrl.replace(/\/+$/, "");

  async function call(args: LLMGenerateJsonArgs<unknown>, retry: boolean): Promise<unknown> {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: args.temperature ?? 0.2 },
        messages: [
          { role: "system", content: args.system },
          {
            role: "user",
            content: args.prompt + (retry ? "\n\nRETRY: respond with a single valid JSON object only." : ""),
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Ollama chat failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as OllamaChatResponse;
    const text = json.message?.content?.trim() ?? "";
    if (!text) throw new Error("Ollama returned empty content");
    const parsed: unknown = JSON.parse(text);
    return args.schema.parse(parsed);
  }

  return {
    name: "ollama",
    model,
    isMock: false,
    async generateJson<T>(args: LLMGenerateJsonArgs<T>): Promise<T> {
      try {
        return (await call(args as LLMGenerateJsonArgs<unknown>, false)) as T;
      } catch {
        return (await call(args as LLMGenerateJsonArgs<unknown>, true)) as T;
      }
    },
  };
}
