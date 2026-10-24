/**
 * Realtime contract. Clients subscribe with supabase-js postgres_changes; RLS filters rows
 * per subscriber. Payload rows are raw DB rows (snake_case), NOT API shapes, so on any event
 * the client refetches the affected resource via the API (or merges minimal fields).
 *
 * Channel name: `paper:${paperId}:group:${groupId}`
 * Subscriptions (all with filter `paper_id=eq.${paperId}`):
 *   - table annotations     events INSERT | UPDATE | DELETE
 *   - table comments        events INSERT | UPDATE   (deletes are soft -> UPDATE)
 *   - table paper_reviews   events INSERT | UPDATE | DELETE
 * Client MUST drop rows whose group_id !== current groupId (a user may be in several groups
 * that share the same canonical paper). DELETE payloads only carry the primary key.
 */
export const REALTIME_TABLES = ["annotations", "comments", "paper_reviews"] as const;
export type RealtimeTable = (typeof REALTIME_TABLES)[number];
export const paperChannelName = (paperId: string, groupId: string) => `paper:${paperId}:group:${groupId}`;
