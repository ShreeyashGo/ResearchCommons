import "server-only";

import { createHash } from "node:crypto";
import type { AiMeta, LLMProvider } from "@/contracts/ai";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** JSON.stringify with recursively sorted keys so hashing is stable. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, val]) => [k, sortDeep(val)]),
    );
  }
  return v;
}

/**
 * ai_summaries cache key per docs/architecture.md §8:
 * sha256(kind | subject ids | sha256(inputs) | promptVersion | provider | model).
 * Provider + model are part of the key, so mock rows can never be served to a
 * real provider.
 */
export function buildCacheKey(args: {
  kind: "paper_summary" | "citation_explanation";
  subjectIds: string[];
  inputsHash: string;
  promptVersion: string;
  provider: string;
  model: string;
}): string {
  return sha256Hex(
    [args.kind, args.subjectIds.join("|"), args.inputsHash, args.promptVersion, args.provider, args.model].join(
      "|",
    ),
  );
}

export function hashInputs(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

interface CachedRow {
  output: unknown;
  provider: string;
  model: string;
  is_mock: boolean;
  prompt_version: string;
  created_at: string;
}

type AdminClient = ReturnType<typeof import("@/server/supabase/admin").createAdminClient>;

export async function getCached<T>(
  admin: AdminClient,
  cacheKey: string,
  provider: LLMProvider,
  schema: { safeParse(input: unknown): { success: boolean; data?: unknown } },
): Promise<{ output: T; meta: AiMeta } | null> {
  const { data, error } = await admin
    .from("ai_summaries")
    .select("output,provider,model,is_mock,prompt_version,created_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as CachedRow;
  // Mock rows are never served to a real provider (provider/model are in the key
  // anyway; this is defense-in-depth).
  if (row.is_mock !== provider.isMock) return null;
  // Cached output that no longer satisfies the schema (e.g. after a schema
  // bump) is treated as a miss and regenerated.
  const parsed = schema.safeParse(row.output);
  if (!parsed.success) return null;
  return {
    output: parsed.data as T,
    meta: {
      provider: row.provider,
      model: row.model,
      isMock: row.is_mock,
      promptVersion: row.prompt_version,
      cached: true,
      generatedAt: row.created_at,
    },
  };
}

export async function storeCached(
  admin: AdminClient,
  row: {
    kind: "paper_summary" | "citation_explanation";
    cacheKey: string;
    paperId: string | null;
    referenceId: string | null;
    externalWorkId: string | null;
    provider: LLMProvider;
    promptVersion: string;
    grounding: "full_text" | "abstract_only" | "metadata_only";
    output: unknown;
  },
): Promise<void> {
  const { error } = await admin.from("ai_summaries").upsert(
    {
      kind: row.kind,
      cache_key: row.cacheKey,
      paper_id: row.paperId,
      reference_id: row.referenceId,
      external_work_id: row.externalWorkId,
      provider: row.provider.name,
      model: row.provider.model,
      is_mock: row.provider.isMock,
      prompt_version: row.promptVersion,
      grounding: row.grounding,
      output: row.output,
    },
    { onConflict: "cache_key" },
  );
  if (error) throw new Error(`ai_summaries insert failed: ${error.message}`);
}
