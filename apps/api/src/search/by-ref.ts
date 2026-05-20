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
  rawQuery: string
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
  start_ms: number
  end_ms: number
  snippet: string
}

// Ref-mode search returns one row per video, ranked by the total number of
// matching scripture references in the transcript. For each ranked video we
// pick the highest-FTS-rank transcript chunk that contains the user's raw query
// text — that chunk supplies the snippet (via ts_headline) and a deep-link
// timestamp. When no chunk text matches (e.g. the citation tokenizes oddly),
// the video still appears with an empty snippet and start_ms=0; the score
// established that the video is about the queried passage even if our text
// search can't locate where.
export async function searchVideosByRef(
  db: Kysely<Database>,
  params: RefSearchParams,
): Promise<{ results: RefSearchResult[]; total: number }> {
  const {
    startCoord,
    endCoord,
    rawQuery,
    limit,
    offset,
    topicSlug,
    playlistSlug,
    publishedAfter,
  } = params

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

  const [videoRows, countRow] = await Promise.all([
    baseQuery
      .groupBy(["v.id", "v.youtube_video_id", "v.title", "v.thumbnail_url"])
      .orderBy(sql`ref_score`, "desc")
      .limit(limit)
      .offset(offset)
      .execute(),
    countBase.executeTakeFirst(),
  ])

  if (videoRows.length === 0) {
    return { results: [], total: Number(countRow?.total ?? 0) }
  }

  const videoIds = videoRows.map((r) => r.id as string)
  const chunkRows = await db
    .selectFrom(
      db
        .selectFrom("transcript_chunks as c")
        .select([
          "c.video_id",
          "c.start_ms",
          "c.end_ms",
          sql<number>`ts_rank_cd(c.text_tsv, plainto_tsquery('english', ${rawQuery}))`.as(
            "chunk_score",
          ),
          sql<string>`ts_headline('english', c.text, plainto_tsquery('english', ${rawQuery}), 'StartSel=<mark>,StopSel=</mark>,MaxFragments=1,MaxWords=20,MinWords=10')`.as(
            "snippet",
          ),
          sql<number>`ROW_NUMBER() OVER (PARTITION BY c.video_id ORDER BY ts_rank_cd(c.text_tsv, plainto_tsquery('english', ${rawQuery})) DESC, c.start_ms ASC)`.as(
            "rn",
          ),
        ])
        .where("c.video_id", "in", videoIds)
        .where(sql<SqlBool>`c.text_tsv @@ plainto_tsquery('english', ${rawQuery})`)
        .as("ranked"),
    )
    .select(["video_id", "start_ms", "end_ms", "snippet"])
    .where("rn", "=", 1)
    .execute()

  const bestByVideo = new Map<
    string,
    { start_ms: number; end_ms: number; snippet: string }
  >()
  for (const row of chunkRows) {
    bestByVideo.set(row.video_id as string, {
      start_ms: Number(row.start_ms),
      end_ms: Number(row.end_ms),
      snippet: row.snippet,
    })
  }

  return {
    results: videoRows.map((r) => {
      const best = bestByVideo.get(r.id as string)
      return {
        youtube_video_id: r.youtube_video_id,
        title: r.title,
        thumbnail_url: r.thumbnail_url,
        ref_score: r.ref_score,
        start_ms: best?.start_ms ?? 0,
        end_ms: best?.end_ms ?? 0,
        snippet: best?.snippet ?? "",
      }
    }),
    total: Number(countRow?.total ?? 0),
  }
}
