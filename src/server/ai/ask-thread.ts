import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  AiMeta,
  AskThreadEntry,
  AskTurn,
  PaperAnswer,
  type AskThreadEntry as AskThreadEntryType,
} from "@/contracts/ai";
import { internal } from "@/server/http/errors";

export async function loadAskHistory(
  supabase: SupabaseClient,
  userId: string,
  groupId: string,
  paperId: string,
): Promise<z.infer<typeof AskTurn>[]> {
  const { data, error } = await supabase
    .from("ask_messages")
    .select("question,answer")
    .eq("user_id", userId)
    .eq("group_id", groupId)
    .eq("paper_id", paperId)
    .order("created_at", { ascending: false })
    .limit(3);
  if (error) throw internal(`ask history read failed: ${error.message}`);

  const history: z.infer<typeof AskTurn>[] = [];
  for (const row of [...(data ?? [])].reverse()) {
    const answer = PaperAnswer.safeParse(row.answer);
    if (!answer.success) continue;
    history.push(
      { role: "user", content: String(row.question).slice(0, 4000) },
      { role: "assistant", content: answer.data.answer.slice(0, 4000) },
    );
  }
  return history;
}

export async function saveAskEntry(
  supabase: SupabaseClient,
  {
    userId,
    groupId,
    paperId,
    question,
    annotationId,
    answer,
    meta,
  }: {
    userId: string;
    groupId: string;
    paperId: string;
    question: string;
    annotationId: string | null;
    answer: z.infer<typeof PaperAnswer>;
    meta: z.infer<typeof AiMeta>;
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("ask_messages")
    .insert({
      user_id: userId,
      group_id: groupId,
      paper_id: paperId,
      question,
      annotation_id: annotationId,
      answer,
      meta,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    console.warn("[ask-thread] save failed:", error?.message ?? "no row returned");
    return null;
  }
  return data.id;
}

export async function listAskThread(
  supabase: SupabaseClient,
  userId: string,
  groupId: string,
  paperId: string,
): Promise<AskThreadEntryType[]> {
  const { data, error } = await supabase
    .from("ask_messages")
    .select("id,question,annotation_id,answer,meta,created_at")
    .eq("user_id", userId)
    .eq("group_id", groupId)
    .eq("paper_id", paperId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw internal(`ask thread read failed: ${error.message}`);

  const entries: AskThreadEntryType[] = [];
  for (const row of [...(data ?? [])].reverse()) {
    const answer = PaperAnswer.safeParse(row.answer);
    const meta = AiMeta.safeParse(row.meta);
    if (!answer.success || !meta.success) continue;
    const entry = AskThreadEntry.safeParse({
      id: row.id,
      question: row.question,
      annotationId: row.annotation_id,
      answer: answer.data,
      meta: meta.data,
      createdAt: row.created_at,
    });
    if (entry.success) entries.push(entry.data);
  }
  return entries;
}

export async function clearAskThread(
  supabase: SupabaseClient,
  userId: string,
  groupId: string,
  paperId: string,
): Promise<void> {
  const { error } = await supabase
    .from("ask_messages")
    .delete()
    .eq("user_id", userId)
    .eq("group_id", groupId)
    .eq("paper_id", paperId);
  if (error) throw internal(`ask thread delete failed: ${error.message}`);
}
