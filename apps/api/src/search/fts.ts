import type { Database } from "@sermon-search/db"
import type { Kysely, SqlBool } from "kysely"
import { sql } from "kysely"

export interface FtsOptions {
  q: string
  videoId?: string
  limit: number
  offset: number
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
  const { q, videoId, limit, offset } = opts

  // Build the tsquery once; if all stopwords this returns no rows cleanly.
  const tsquery = sql<string>`plainto_tsquery('english', ${q})`
  const ftsMatch = sql<SqlBool>`ts.text_tsv @@ ${tsquery}`

  let baseQuery = db
    .selectFrom("transcript_segments as ts")
    .innerJoin("videos as v", "v.id", "ts.video_id")
    .select([
      "v.youtube_video_id",
      "v.title",
      "v.thumbnail_url",
      "ts.start_ms",
      sql<number>`ts_rank_cd(ts.text_tsv, ${tsquery})`.as("score"),
      sql<string>`ts_headline('english', ts.text, ${tsquery}, 'StartSel=<mark>,StopSel=</mark>,MaxFragments=1,MaxWords=20,MinWords=10')`.as(
        "snippet",
      ),
    ])
    .where(ftsMatch)

  if (videoId !== undefined) {
    baseQuery = baseQuery.where("v.youtube_video_id", "=", videoId)
  }

  const [rows, countRow] = await Promise.all([
    baseQuery
      .orderBy(sql`score`, "desc")
      .orderBy("ts.start_ms", "asc")
      .limit(limit)
      .offset(offset)
      .execute(),

    db
      .selectFrom("transcript_segments as ts")
      .innerJoin("videos as v", "v.id", "ts.video_id")
      .select(sql<string>`count(*)`.as("count"))
      .where(sql<SqlBool>`ts.text_tsv @@ ${tsquery}`)
      .$if(videoId !== undefined, (qb) => qb.where("v.youtube_video_id", "=", videoId as string))
      .executeTakeFirstOrThrow(),
  ])

  return {
    results: rows,
    total: Number(countRow.count),
  }
}
