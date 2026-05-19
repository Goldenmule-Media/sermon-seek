import type { Database } from "@sermon-search/db"
import type { Embedder } from "@sermon-search/embeddings"
import type { Kysely, SqlBool } from "kysely"
import { sql } from "kysely"
import type { FtsResponse, FtsResult } from "./fts.js"

export interface SemanticOptions {
  q: string
  videoId?: string
  limit: number
  offset: number
  topicSlug?: string
  playlistSlug?: string
  publishedAfter?: Date
}

function firstWords(text: string, n = 20): string {
  return text.split(/\s+/).slice(0, n).join(" ")
}

export async function searchSemantic(
  db: Kysely<Database>,
  embedder: Embedder,
  opts: SemanticOptions,
): Promise<FtsResponse> {
  const { q, videoId, limit, offset, topicSlug, playlistSlug, publishedAfter } = opts

  const [queryVec] = await embedder.embed([q])
  const vecStr = `[${(queryVec as number[]).join(",")}]`

  type Row = {
    youtube_video_id: string
    title: string
    thumbnail_url: string | null
    start_ms: number
    score: number
    text: string
  }

  let query = db
    .selectFrom("embeddings as e")
    .innerJoin("transcript_chunks as c", "c.id", "e.chunk_id")
    .innerJoin("videos as v", "v.id", "c.video_id")
    .select([
      "v.youtube_video_id",
      "v.title",
      "v.thumbnail_url",
      "c.start_ms",
      "c.text",
      sql<number>`1 - (e.vector <=> ${vecStr}::vector)`.as("score"),
    ])
    .where("e.model", "=", embedder.model)
    .orderBy(sql`e.vector <=> ${vecStr}::vector`, "asc")
    .limit(limit)
    .offset(offset)

  let countQuery = db
    .selectFrom("embeddings as e")
    .innerJoin("transcript_chunks as c", "c.id", "e.chunk_id")
    .innerJoin("videos as v", "v.id", "c.video_id")
    .select(sql<string>`count(*)`.as("count"))
    .where("e.model", "=", embedder.model)

  if (videoId !== undefined) {
    query = query.where("v.youtube_video_id", "=", videoId)
    countQuery = countQuery.where("v.youtube_video_id", "=", videoId)
  }
  if (topicSlug !== undefined) {
    const pred = sql<SqlBool>`v.id IN (SELECT vt.video_id FROM video_topics vt INNER JOIN topics t ON t.id = vt.topic_id WHERE t.slug = ${topicSlug})`
    query = query.where(pred)
    countQuery = countQuery.where(pred)
  }
  if (playlistSlug !== undefined) {
    const pred = sql<SqlBool>`v.id IN (SELECT vp.video_id FROM video_playlists vp INNER JOIN playlists p ON p.id = vp.playlist_id WHERE p.slug = ${playlistSlug})`
    query = query.where(pred)
    countQuery = countQuery.where(pred)
  }
  if (publishedAfter !== undefined) {
    query = query.where("v.published_at", ">=", publishedAfter)
    countQuery = countQuery.where("v.published_at", ">=", publishedAfter)
  }

  const rows = (await query.execute()) as Row[]
  const countRow = await countQuery.executeTakeFirstOrThrow()

  const results: FtsResult[] = rows.map((r) => ({
    youtube_video_id: r.youtube_video_id,
    title: r.title,
    thumbnail_url: r.thumbnail_url,
    start_ms: r.start_ms,
    score: r.score,
    snippet: firstWords(r.text),
  }))

  return { results, total: Number(countRow.count) }
}
