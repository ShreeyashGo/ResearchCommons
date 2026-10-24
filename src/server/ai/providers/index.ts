import "server-only";

import type { LLMProvider } from "@/contracts/ai";
import { parseServerEnv } from "@/server/env";
import { geminiProvider } from "./gemini";
import { mockProvider } from "./mock";
import { ollamaProvider } from "./ollama";

let cached: LLMProvider | null = null;

/** Provider selected by AI_PROVIDER (mock is the local default). */
export function getProvider(): LLMProvider {
  if (cached) return cached;
  const env = parseServerEnv();
  switch (env.AI_PROVIDER) {
    case "gemini":
      cached = geminiProvider(env.GEMINI_API_KEY as string, env.GEMINI_MODEL);
      break;
    case "ollama":
      cached = ollamaProvider(env.OLLAMA_BASE_URL, env.OLLAMA_MODEL);
      break;
    default:
      cached = mockProvider;
  }
  return cached;
}
