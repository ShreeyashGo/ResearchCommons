import "server-only";

/**
 * Stub for the ML track's citation-intelligence pipeline (docs/architecture.md §7).
 * Called via Next `after()` after a paper is imported or uploaded. The ML
 * implementation replaces this file; do not add logic here.
 */
export async function startPaperProcessing(paperId: string): Promise<void> {
  void paperId;
}
