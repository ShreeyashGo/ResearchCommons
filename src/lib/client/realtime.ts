"use client";

import { paperChannelName, REALTIME_TABLES, type RealtimeTable } from "@/contracts";
import { API_MOCK } from "./api";
import { onMockChange } from "./mock";
import { createBrowserSupabaseClient } from "./supabase";

export type PaperChangeHandler = (table: RealtimeTable) => void;

/**
 * Subscribe to postgres_changes on this paper per src/contracts/realtime.ts:
 * channel `paper:${pid}:group:${gid}`, rows filtered server-side by paper_id;
 * we additionally drop rows whose group_id isn't ours (a canonical paper can
 * live in several groups), then the caller refetches via the API.
 *
 * Returns an unsubscribe function. In mock mode, wires to the in-memory mock
 * bus instead of Supabase.
 */
export function subscribePaper(
  groupId: string,
  paperId: string,
  onChange: PaperChangeHandler,
): () => void {
  if (API_MOCK) {
    return onMockChange((e) => {
      if (e.groupId === groupId && e.paperId === paperId) {
        onChange(e.table as RealtimeTable);
      }
    });
  }

  const supabase = createBrowserSupabaseClient();
  const channel = supabase.channel(paperChannelName(paperId, groupId));

  for (const table of REALTIME_TABLES) {
    const events = table === "comments" ? (["INSERT", "UPDATE"] as const) : (["INSERT", "UPDATE", "DELETE"] as const);
    for (const event of events) {
      channel.on(
        "postgres_changes",
        { event, schema: "public", table, filter: `paper_id=eq.${paperId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { group_id?: string } | undefined;
          if (row?.group_id && row.group_id !== groupId) return;
          onChange(table);
        },
      );
    }
  }

  channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
