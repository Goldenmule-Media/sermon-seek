import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"

// Per-video LLM-generated summary, keyed by youtube_video_id. Returned as a Map
// so callers can attach it to grouped search results without N+1 queries.
export async function hydrateSummaries(
  db: Kysely<Database>,
  youtubeVideoIds: string[],
): Promise<Map<string, string>> {
  if (youtubeVideoIds.length === 0) return new Map()
  const rows = await db
    .selectFrom("video_enrichments as e")
    .innerJoin("videos as v", "v.id", "e.video_id")
    .select(["v.youtube_video_id", "e.summary"])
    .where("v.youtube_video_id", "in", youtubeVideoIds)
    .execute()
  const map = new Map<string, string>()
  for (const r of rows) {
    if (r.summary) map.set(r.youtube_video_id, r.summary)
  }
  return map
}
