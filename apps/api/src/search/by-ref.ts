import type { Database } from "@sermon-search/db"
import { extract } from "@sermon-search/scripture"
import type { Kysely, SqlBool } from "kysely"
import { sql } from "kysely"

export class BadRefError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BadRefError"
  }
}

export function parseRefQuery(input: string): { start_coord: number; end_coord: number } {
  const refs = extract(input)
  if (refs.length === 0) {
    throw new BadRefError("no scripture reference found in query")
  }
  if (refs.length > 1) {
    throw new BadRefError(`expected a single scripture reference, found ${refs.length}`)
  }
  return { start_coord: refs[0]!.start_coord, end_coord: refs[0]!.end_coord }
}

export interface RefSearchParams {
  startCoord: number
  endCoord: number
  limit: number
  offset: number
  topicSlug?: string
  playlistSlug?: string
  publishedAfter?: Date
}

export interface RefSearchResult {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  ref_score: number
}

export async function searchVideosByRef(
  db: Kysely<Database>,
  params: RefSearchParams,
): Promise<{ results: RefSearchResult[]; total: number }> {
  const { startCoord, endCoord, limit, offset, topicSlug, playlistSlug, publishedAfter } = params

  const overlapEnd = sql<SqlBool>`${endCoord} >= r.start_coord`
  const overlapStart = sql<SqlBool>`${startCoord} <= r.end_coord`

  let baseQuery = db
    .selectFrom("videos as v")
    .innerJoin("video_scripture_refs as r", "r.video_id", "v.id")
    .select([
      "v.id",
      "v.youtube_video_id",
      "v.title",
      "v.thumbnail_url",
      sql<number>`SUM(r.occurrences)::int`.as("ref_score"),
    ])
    .where(overlapEnd)
    .where(overlapStart)

  let countBase = db
    .selectFrom("videos as v")
    .innerJoin("video_scripture_refs as r", "r.video_id", "v.id")
    .select(sql<string>`COUNT(DISTINCT v.id)`.as("total"))
    .where(overlapEnd)
    .where(overlapStart)

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
      .groupBy("v.id")
      .orderBy(sql`ref_score`, "desc")
      .limit(limit)
      .offset(offset)
      .execute(),
    countBase.executeTakeFirst(),
  ])

  return {
    results: rows.map((r) => ({
      youtube_video_id: r.youtube_video_id,
      title: r.title,
      thumbnail_url: r.thumbnail_url,
      ref_score: r.ref_score,
    })),
    total: Number(countRow?.total ?? 0),
  }
}
