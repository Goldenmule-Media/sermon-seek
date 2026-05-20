import type { Database } from "@sermon-search/db"
import { type Kysely, type SqlBool, sql } from "kysely"
import type { FtsResult } from "./fts.js"

// Chunks are 30–60s rolling windows, so a chunk's start_ms can sit well before the
// phrase the user actually searched for. After chunk-level matching, narrow the
// timestamp by finding the segment inside the chunk that best matches the query.
//
// Two-tier strategy:
//   1. Strict AND match — earliest segment whose tsvector contains every query
//      lexeme. Best when the full phrase fits in one cue.
//   2. OR fallback — if no single segment AND-matches (common for multi-word
//      queries whose lexemes split across short cues), pick the segment with the
//      highest ts_rank_cd against an OR'd version of the query. This lands the
//      user on the densest match inside the chunk rather than the chunk's start.
//
// If both tiers find nothing, keep the chunk start_ms.
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
        const andRow = await db
          .selectFrom("transcript_segments as s")
          .innerJoin("videos as v", "v.id", "s.video_id")
          .select(sql<number | null>`MIN(s.start_ms)`.as("refined"))
          .where("v.youtube_video_id", "=", r.youtube_video_id)
          .where("s.start_ms", ">=", r.start_ms)
          .where("s.start_ms", "<", r.end_ms)
          .where(sql<SqlBool>`s.text_tsv @@ plainto_tsquery('english', ${q})`)
          .executeTakeFirst()
        if (andRow?.refined != null) return { ...r, start_ms: Number(andRow.refined) }

        // OR-tier: convert plainto_tsquery's ' & ' joins to ' | ' so any single
        // matching lexeme qualifies, then rank by density. Empty/null tsquery
        // (e.g. all-stopword input) yields no rows and we fall through.
        const orQuery = sql<string>`to_tsquery('english', nullif(regexp_replace(plainto_tsquery('english', ${q})::text, ' & ', ' | ', 'g'), ''))`
        const orRow = await db
          .selectFrom("transcript_segments as s")
          .innerJoin("videos as v", "v.id", "s.video_id")
          .select(["s.start_ms"])
          .where("v.youtube_video_id", "=", r.youtube_video_id)
          .where("s.start_ms", ">=", r.start_ms)
          .where("s.start_ms", "<", r.end_ms)
          .where(sql<SqlBool>`s.text_tsv @@ ${orQuery}`)
          .orderBy(sql`ts_rank_cd(s.text_tsv, ${orQuery})`, "desc")
          .orderBy("s.start_ms", "asc")
          .limit(1)
          .executeTakeFirst()
        if (orRow?.start_ms != null) return { ...r, start_ms: Number(orRow.start_ms) }
      } catch {
        // Defensive: if the segment lookup fails for any reason, fall back to the
        // chunk start_ms rather than dropping the result.
      }
      return r
    }),
  )
}
