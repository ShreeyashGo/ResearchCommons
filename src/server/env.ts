import "server-only";

import { z } from "zod";

export const serverEnvSchema = z
  .object({
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    AI_PROVIDER: z.enum(["mock", "gemini", "ollama"]).default("mock"),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
    OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
    OLLAMA_MODEL: z.string().default("llama3.1"),
    S2_API_KEY: z.string().optional(),
    CONTACT_EMAIL: z.string().email().optional(),
  })
  .superRefine((env, context) => {
    if (env.AI_PROVIDER === "gemini" && !env.GEMINI_API_KEY) {
      context.addIssue({
        code: "custom",
        path: ["GEMINI_API_KEY"],
        message: "GEMINI_API_KEY is required when AI_PROVIDER is gemini",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(
  env: Record<string, string | undefined> = process.env,
): ServerEnv {
  return serverEnvSchema.parse(env);
}
