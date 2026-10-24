import "server-only";

import {
  CitationExplanation,
  type AiMeta,
  type CitationInput,
  type Grounding,
  type LLMProvider,
} from "@/contracts/ai";
import { createAdminClient } from "@/server/supabase/admin";
import { buildCacheKey, getCached, hashInputs, storeCached } from "./cache";
import { EXPLAIN_SYSTEM, PROMPT_VERSION, buildExplainPrompt } from "./prompts";
import { getProvider } from "./providers";

export class AiOutputError extends Error {}

export interface ExplainIds {
  paperId: string;
  referenceId: string;
  externalWorkId: string | null;
}

export interface ExplainResult {
  explanation: CitationExplanation;
  meta: AiMeta;
}

export type ExplainForReferenceResult =
  | { status: "unavailable"; reason: string }
  | { status: "ok"; explanation: CitationExplanation; meta: AiMeta };

/**
 * Load a paper's reference + its citation contexts and produce (or serve the
 * cached) explanation. `unavailable` when the reference is unresolved, has no
 * contexts, or its metadata is missing. Uses the service-role client: callers
 * MUST authorize with the user-scoped client first.
 */
export async function explainCitationForReference(
  paperId: string,
  referenceId: string,
  provider: LLMProvider = getProvider(),
): Promise<ExplainForReferenceResult> {
  const admin = createAdminClient();
  const { data: ref, error: refErr } = await admin
    .from("paper_references")
    .select(
      "id,paper_id,ordinal,label,raw_text,parsed_title,parsed_authors,parsed_year,match_status,external_work_id",
    )
    .eq("id", referenceId)
    .eq("paper_id", paperId)
    .maybeSingle();
  if (refErr) throw new Error(`paper_references read failed: ${refErr.message}`);
  if (!ref) return { status: "unavailable", reason: "reference not found" };
  if (ref.match_status !== "resolved" || !ref.external_work_id) {
    return {
      status: "unavailable",
      reason: `reference is ${ref.match_status}; only resolved references can be explained`,
    };
  }

  const { data: ctxRows, error: ctxErr } = await admin
    .from("citation_contexts")
    .select("sentence,paragraph,marker_text")
    .eq("reference_id", referenceId)
    .order("page_index");
  if (ctxErr) throw new Error(`citation_contexts read failed: ${ctxErr.message}`);
  if (!ctxRows || ctxRows.length === 0) {
    return { status: "unavailable", reason: "no citation contexts were recorded for this reference" };
  }

  const [{ data: paper, error: pErr }, { data: work, error: wErr }] = await Promise.all([
    admin.from("papers").select("id,title,abstract").eq("id", paperId).maybeSingle(),
    admin.from("external_works").select("*").eq("id", ref.external_work_id).maybeSingle(),
  ]);
  if (pErr) throw new Error(`papers read failed: ${pErr.message}`);
  if (wErr) throw new Error(`external_works read failed: ${wErr.message}`);
  if (!paper || !work) return { status: "unavailable", reason: "paper metadata is unavailable" };

  const input: CitationInput = {
    citingPaper: { id: paper.id, title: paper.title, abstract: paper.abstract ?? null },
    citedWork: {
      title: work.title,
      authors: work.authors ?? [],
      year: work.year,
      abstract: work.abstract ?? null,
      url: work.url ?? null,
    },
    contexts: ctxRows.map((c) => ({
      sentence: c.sentence,
      paragraph: c.paragraph ?? null,
      markerText: c.marker_text,
    })),
  };

  const result = await explainCitation(
    input,
    { paperId, referenceId, externalWorkId: ref.external_work_id },
    provider,
  );
  return { status: "ok", explanation: result.explanation, meta: result.meta };
}

function normalizeForCompare(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Verbatim-evidence check: every supporting quote must appear verbatim in the
 * inputs (whitespace-collapsed). Quotes that fail are dropped; if none survive
 * the call fails per docs/architecture.md §8.
 */
export function filterEvidence(input: CitationInput, explanation: CitationExplanation): CitationExplanation {
  const contextHay = normalizeForCompare(
    input.contexts.map((c) => `${c.sentence}\n${c.paragraph ?? ""}`).join("\n"),
  );
  const citingHay = normalizeForCompare(input.citingPaper.abstract ?? "");
  const abstractHay = normalizeForCompare(
    [input.citedWork.abstract, input.citedWork.fullText].filter(Boolean).join("\n"),
  );

  const keep = explanation.supportingEvidence.filter((e) => {
    const q = normalizeForCompare(e.quote);
    if (q.length < 8) return false;
    if (e.source === "cited_abstract") return abstractHay.includes(q);
    return contextHay.includes(q) || citingHay.includes(q);
  });
  if (keep.length === 0) {
    throw new AiOutputError("provider produced no verifiable supporting evidence");
  }
  return { ...explanation, supportingEvidence: keep };
}

function explanationGrounding(input: CitationInput): Grounding {
  if (input.citedWork.fullText) return "full_text";
  if (input.citedWork.abstract) return "abstract_only";
  return "metadata_only";
}

/** Cached-or-generate citation explanation. */
export async function explainCitation(
  input: CitationInput,
  ids: ExplainIds,
  provider: LLMProvider = getProvider(),
): Promise<ExplainResult> {
  const grounding = explanationGrounding(input);
  const inputsHash = hashInputs(input);
  const subjectIds = [ids.paperId, ids.referenceId, ids.externalWorkId].filter(
    (s): s is string => Boolean(s),
  );
  const cacheKey = buildCacheKey({
    kind: "citation_explanation",
    subjectIds,
    inputsHash,
    promptVersion: PROMPT_VERSION.citation_explanation,
    provider: provider.name,
    model: provider.model,
  });

  const admin = createAdminClient();
  const hit = await getCached<CitationExplanation>(admin, cacheKey, provider, CitationExplanation);
  if (hit) return { explanation: hit.output, meta: hit.meta };

  let generated: CitationExplanation;
  try {
    generated = await provider.generateJson<CitationExplanation>({
      system: EXPLAIN_SYSTEM,
      prompt: buildExplainPrompt(input),
      schema: CitationExplanation,
      task: "citation_explanation",
      temperature: 0.2,
    });
  } catch (err) {
    throw new AiOutputError(
      `provider failed to produce a valid explanation: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const withGrounding: CitationExplanation = { ...generated, grounding };
  const explanation = filterEvidence(input, withGrounding);

  await storeCached(admin, {
    kind: "citation_explanation",
    cacheKey,
    paperId: ids.paperId,
    referenceId: ids.referenceId,
    externalWorkId: ids.externalWorkId,
    provider,
    promptVersion: PROMPT_VERSION.citation_explanation,
    grounding,
    output: explanation,
  });

  return {
    explanation,
    meta: {
      provider: provider.name,
      model: provider.model,
      isMock: provider.isMock,
      promptVersion: PROMPT_VERSION.citation_explanation,
      cached: false,
      generatedAt: new Date().toISOString(),
    },
  };
}
