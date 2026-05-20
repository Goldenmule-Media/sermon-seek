import type { Database } from "@sermon-search/db"
import type { Kysely, SqlBool } from "kysely"
import { sql } from "kysely"

export interface FtsOptions {
  q: string
  videoId?: string
  limit: number
  offset: number
  topicSlug?: string
  playlistSlug?: string
  publishedAfter?: Date
}

export interface FtsResult {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  start_ms: number
  score: number
  snippet: string
}

export interface FtsResponse {
  results: FtsResult[]
  total: number
}

export async function searchSegments(db: Kysely<Database>, opts: FtsOptions): Promise<FtsResponse> {
  const { q, videoId, limit, offset, topicSlug, playlistSlug, publishedAfter } = opts

  // FTS runs over transcript_chunks (30–60s rolling windows with one-segment
  // overlap), not transcript_segments. Per-cue segments are too small for
  // Postgres FTS — `ts_vector @@ tsquery` requires every query lexeme to live
  // in the same tsvector, so multi-word queries like "Psalm 127" silently miss
  // any time their lexemes fall in adjacent cues. Chunks (with overlap) ensure
  // the lexemes co-locate in at least one row.
  const tsquery = sql<string>`plainto_tsquery('english', ${q})`
  const ftsMatch = sql<SqlBool>`c.text_tsv @@ ${tsquery}`

  let baseQuery = db
    .selectFrom("transcript_chunks as c")
    .innerJoin("videos as v", "v.id", "c.video_id")
    .select([
      "v.youtube_video_id",
      "v.title",
      "v.thumbnail_url",
      "c.start_ms",
      sql<number>`ts_rank_cd(c.text_tsv, ${tsquery})`.as("score"),
      sql<string>`ts_headline('english', c.text, ${tsquery}, 'StartSel=<mark>,StopSel=</mark>,MaxFragments=1,MaxWords=20,MinWords=10')`.as(
        "snippet",
      ),
    ])
    .where(ftsMatch)

  let countBase = db
    .selectFrom("transcript_chunks as c")
    .innerJoin("videos as v", "v.id", "c.video_id")
    .select(sql<string>`count(*)`.as("count"))
    .where(sql<SqlBool>`c.text_tsv @@ ${tsquery}`)

  if (videoId !== undefined) {
    baseQuery = baseQuery.where("v.youtube_video_id", "=", videoId)
    countBase = countBase.where("v.youtube_video_id", "=", videoId)
  }
  if (topicSlug !== undefined) {
    const pred = sql<SqlBool>`v.id IN (SELECT vt.video_id FROM video_topics vt INNER JOIN topics t ON t.id = vt.topic_id WHERE t.slug = ${topicSlug})`
    baseQuery = baseQuery.where(pred)
    countBase = countBase.where(pred)
  }
  if (playlistSlug !== undefined) {
    const pred = sql<SqlBool>`v.id IN (SELECT vp.video_id FROM video_playlists vp INNER JOIN playlists p ON p.id = vp.playlist_id WHERE p.slug = ${playlistSlug})`
    baseQuery = baseQuery.where(pred)
    countBase = countBase.where(pred)
  }
  if (publishedAfter !== undefined) {
    baseQuery = baseQuery.where("v.published_at", ">=", publishedAfter)
    countBase = countBase.where("v.published_at", ">=", publishedAfter)
  }

  const [rows, countRow] = await Promise.all([
    baseQuery
      .orderBy(sql`score`, "desc")
      .orderBy("c.start_ms", "asc")
      .limit(limit)
      .offset(offset)
      .execute(),
    countBase.executeTakeFirstOrThrow(),
  ])

  return {
    results: rows,
    total: Number(countRow.count),
  }
}
