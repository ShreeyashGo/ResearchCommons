import "server-only";

import type { LLMGenerateJsonArgs, LLMProvider } from "@/contracts/ai";
import { fetchWithBackoff } from "@/server/http/fetch-backoff";
import { JSON_RETRY_NUDGE, LLM_BACKOFF, parseModelJson, throwHttpError, withJsonRetry, type ProviderDeps } from "./shared";

interface OllamaChatResponse {
  message?: { content?: string };
}

/** Local Ollama provider (http://127.0.0.1:11434 by default). */
export function ollamaProvider(baseUrl: string, model: string, deps: ProviderDeps = {}): LLMProvider {
  const base = baseUrl.replace(/\/+$/, "");

  async function call<T>(args: LLMGenerateJsonArgs<T>, nudge: boolean): Promise<T> {
    const res = await fetchWithBackoff(
      `${base}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          format: "json",
          options: { temperature: args.temperature ?? 0.2 },
          messages: [
            { role: "system", content: args.system },
            { role: "user", content: args.prompt + (nudge ? JSON_RETRY_NUDGE : "") },
          ],
        }),
      },
      { ...LLM_BACKOFF, ...deps },
    );
    if (!res.ok) return throwHttpError("Ollama", res);
    const json = (await res.json()) as OllamaChatResponse;
    return parseModelJson("Ollama", json.message?.content?.trim() ?? "", args);
  }

  return {
    name: "ollama",
    model,
    isMock: false,
    generateJson: (args) => withJsonRetry((nudge) => call(args, nudge)),
  };
}
