import "server-only";

import { WorkSummary, type AiMeta, type Grounding, type WorkInput } from "@/contracts/ai";
import { extractPdf } from "@/server/citations/extract";
import { createAdminClient } from "@/server/supabase/admin";
import { AiOutputError } from "./explain";
import { buildCacheKey, getCached, hashInputs, storeCached } from "./cache";
import { PROMPT_VERSION, SUMMARY_SYSTEM, buildSummaryPrompt } from "./prompts";
import { getProvider } from "./providers";
import type { LLMProvider } from "@/contracts/ai";

export interface SummarySubject {
  paperId?: string;
  externalWorkId?: string;
}

export interface SummarizeResult {
  summary: WorkSummary;
  meta: AiMeta;
}

export function summaryGrounding(work: WorkInput): Grounding {
  if (work.fullText) return "full_text";
  if (work.abstract) return "abstract_only";
  return "metadata_only";
}

const FULL_TEXT_LIMIT = 40_000;

/**
 * Cached-or-generate summary of a stored paper row, grounded in the stored PDF
 * (best-effort full text) or its abstract/metadata. Returns null when the paper
 * does not exist. Uses the service-role client: callers MUST authorize first.
 */
export async function summarizePaper(
  paperId: string,
  provider: LLMProvider = getProvider(),
): Promise<SummarizeResult | null> {
  const admin = createAdminClient();
  const { data: paper, error } = await admin
    .from("papers")
    .select("id,title,authors,year,abstract,storage_path")
    .eq("id", paperId)
    .maybeSingle();
  if (error) throw new Error(`papers read failed: ${error.message}`);
  if (!paper) return null;

  let fullText: string | undefined;
  if (paper.storage_path) {
    try {
      const { data: blob, error: dlErr } = await admin.storage
        .from("papers")
        .download(paper.storage_path);
      if (!dlErr && blob) {
        const extracted = await extractPdf(new Uint8Array(await blob.arrayBuffer()));
        const text = extracted.pages
          .map((p) => p.text)
          .join("\n")
          .replace(/\s+/g, " ")
          .trim();
        if (text.length > 200) fullText = text.slice(0, FULL_TEXT_LIMIT);
      }
    } catch {
      // best-effort: extraction failures degrade to abstract_only grounding
    }
  }

  return summarizeWork(
    {
      title: paper.title,
      authors: paper.authors ?? [],
      year: paper.year,
      abstract: paper.abstract ?? null,
      fullText,
    },
    { paperId },
    provider,
  );
}

/**
 * Summarize ONE work (cached). With no subject ids, the cache key still works —
 * the input hash already pins the content; callers should pass the paper or
 * external_work id whenever one exists.
 */
export async function summarizeWork(
  work: WorkInput,
  subject: SummarySubject = {},
  provider: LLMProvider = getProvider(),
): Promise<SummarizeResult> {
  const grounding = summaryGrounding(work);
  const inputsHash = hashInputs(work);
  const cacheKey = buildCacheKey({
    kind: "paper_summary",
    subjectIds: [subject.paperId, subject.externalWorkId].filter((s): s is string => Boolean(s)),
    inputsHash,
    promptVersion: PROMPT_VERSION.paper_summary,
    provider: provider.name,
    model: provider.model,
  });

  const admin = createAdminClient();
  const hit = await getCached<WorkSummary>(admin, cacheKey, provider, WorkSummary);
  if (hit) return { summary: hit.output, meta: hit.meta };

  let generated: WorkSummary;
  try {
    generated = await provider.generateJson<WorkSummary>({
      system: SUMMARY_SYSTEM,
      prompt: buildSummaryPrompt(work),
      schema: WorkSummary,
      task: "paper_summary",
      temperature: 0.2,
    });
  } catch (err) {
    throw new AiOutputError(
      `provider failed to produce a valid summary: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Grounding is computed from what we actually supplied, never trusted to the model.
  const summary: WorkSummary = { ...generated, grounding };

  // ai_summaries requires a subject id; uncacheable anonymous works just return.
  if (subject.paperId || subject.externalWorkId) {
    await storeCached(admin, {
      kind: "paper_summary",
      cacheKey,
      paperId: subject.paperId ?? null,
      externalWorkId: subject.externalWorkId ?? null,
      referenceId: null,
      provider,
      promptVersion: PROMPT_VERSION.paper_summary,
      grounding,
      output: summary,
    });
  }

  return {
    summary,
    meta: {
      provider: provider.name,
      model: provider.model,
      isMock: provider.isMock,
      promptVersion: PROMPT_VERSION.paper_summary,
      cached: false,
      generatedAt: new Date().toISOString(),
    },
  };
}
