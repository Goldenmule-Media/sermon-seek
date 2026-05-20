import type { Database } from "@sermon-search/db"
import { type Kysely, type SqlBool, sql } from "kysely"
import type { FtsResult } from "./fts.js"

// Chunks are 30–60s rolling windows, so a chunk's start_ms can sit well before the
// phrase the user actually searched for. After chunk-level matching, narrow the
// timestamp by finding the first transcript_segment INSIDE the chunk whose text
// matches all the query lexemes (AND match — same semantics as plainto_tsquery).
// When no segment matches (e.g. a purely conceptual semantic hit, or query lexemes
// split across adjacent segments), keep the chunk start_ms.
export async function refineSegmentStarts(
  db: Kysely<Database>,
  q: string,
  results: FtsResult[],
): Promise<FtsResult[]> {
  if (results.length === 0) return results
  if (q.trim().length === 0) return results

  return Promise.all(
    results.map(async (r) => {
      try {
        const row = await db
          .selectFrom("transcript_segments as s")
          .innerJoin("videos as v", "v.id", "s.video_id")
          .select(sql<number | null>`MIN(s.start_ms)`.as("refined"))
          .where("v.youtube_video_id", "=", r.youtube_video_id)
          .where("s.start_ms", ">=", r.start_ms)
          .where("s.start_ms", "<", r.end_ms)
          .where(sql<SqlBool>`s.text_tsv @@ plainto_tsquery('english', ${q})`)
          .executeTakeFirst()
        if (row?.refined != null) return { ...r, start_ms: Number(row.refined) }
      } catch {
        // Defensive: if the segment lookup fails for any reason, fall back to the
        // chunk start_ms rather than dropping the result.
      }
      return r
    }),
  )
}
