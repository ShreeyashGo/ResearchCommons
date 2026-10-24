import "server-only";

import { AskTurn, PaperAnswer, type AiMeta, type Grounding, type LLMProvider } from "@/contracts/ai";
import type { z } from "zod";
import { extractPdf } from "@/server/citations/extract";
import { createAdminClient } from "@/server/supabase/admin";
import { AiOutputError } from "./explain";
import { ASK_SYSTEM, PROMPT_VERSION, buildAskPrompt } from "./prompts";
import { getProvider } from "./providers";

const FULL_TEXT_LIMIT = 40_000;

export interface AskPaperArgs {
  question: string;
  history: z.infer<typeof AskTurn>[];
  focusPassage?: { pageIndex: number; quote: string };
}

export interface AskPaperResult {
  answer: PaperAnswer;
  meta: AiMeta;
}

/**
 * Q&A over a stored paper row, grounded in the extracted full text (page-tagged,
 * best-effort) or the abstract/metadata. Not cached or persisted (MVP). Returns
 * null when the paper does not exist. Uses the service-role client: callers MUST
 * authorize first.
 */
export async function askPaper(
  paperId: string,
  args: AskPaperArgs,
  provider: LLMProvider = getProvider(),
): Promise<AskPaperResult | null> {
  const admin = createAdminClient();
  const { data: paper, error } = await admin
    .from("papers")
    .select("id,title,abstract,storage_path")
    .eq("id", paperId)
    .maybeSingle();
  if (error) throw new Error(`papers read failed: ${error.message}`);
  if (!paper) return null;

  let pages: Array<{ pageIndex: number; text: string }> | undefined;
  if (paper.storage_path) {
    try {
      const { data: blob, error: dlErr } = await admin.storage
        .from("papers")
        .download(paper.storage_path);
      if (!dlErr && blob) {
        const extracted = await extractPdf(new Uint8Array(await blob.arrayBuffer()));
        let budget = FULL_TEXT_LIMIT;
        const tagged: Array<{ pageIndex: number; text: string }> = [];
        for (const page of extracted.pages) {
          const text = page.text.replace(/\s+/g, " ").trim();
          if (!text || budget <= 0) continue;
          tagged.push({ pageIndex: page.pageIndex, text: text.slice(0, budget) });
          budget -= text.length;
        }
        const total = tagged.reduce((n, p) => n + p.text.length, 0);
        if (total > 200) pages = tagged;
      }
    } catch (err) {
      console.warn(`[ask] full-text extraction failed for ${paperId}:`, err);
    }
  }

  const grounding: Grounding = pages ? "full_text" : paper.abstract ? "abstract_only" : "metadata_only";

  let generated: PaperAnswer;
  try {
    generated = await provider.generateJson<PaperAnswer>({
      system: ASK_SYSTEM,
      prompt: buildAskPrompt({
        question: args.question,
        history: args.history,
        paper: { title: paper.title, abstract: paper.abstract ?? null },
        pages,
        focusPassage: args.focusPassage,
      }),
      schema: PaperAnswer,
      task: "ask_paper",
      temperature: 0.2,
    });
  } catch (err) {
    throw new AiOutputError(
      `provider failed to produce a valid answer: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Grounding is computed from what we actually supplied, never trusted to the model.
  return {
    answer: { ...generated, grounding },
    meta: {
      provider: provider.name,
      model: provider.model,
      isMock: provider.isMock,
      promptVersion: PROMPT_VERSION.ask_paper,
      cached: false,
      generatedAt: new Date().toISOString(),
    },
  };
}
