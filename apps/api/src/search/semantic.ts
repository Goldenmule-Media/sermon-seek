import type { Database } from "@sermon-search/db"
import type { Embedder } from "@sermon-search/embeddings"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import type { FtsResponse, FtsResult } from "./fts.js"

export interface SemanticOptions {
  q: string
  videoId?: string
  limit: number
  offset: number
}

function firstWords(text: string, n = 20): string {
  return text.split(/\s+/).slice(0, n).join(" ")
}

export async function searchSemantic(
  db: Kysely<Database>,
  embedder: Embedder,
  opts: SemanticOptions,
): Promise<FtsResponse> {
  const { q, videoId, limit, offset } = opts

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

  if (videoId !== undefined) {
    query = query.where("v.youtube_video_id", "=", videoId)
  }

  const rows = (await query.execute()) as Row[]

  let countQuery = db
    .selectFrom("embeddings as e")
    .innerJoin("transcript_chunks as c", "c.id", "e.chunk_id")
    .innerJoin("videos as v", "v.id", "c.video_id")
    .select(sql<string>`count(*)`.as("count"))
    .where("e.model", "=", embedder.model)

  if (videoId !== undefined) {
    countQuery = countQuery.where("v.youtube_video_id", "=", videoId)
  }

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
