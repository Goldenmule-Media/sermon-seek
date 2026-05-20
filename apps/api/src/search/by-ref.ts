import type { Database } from "@sermon-search/db"
import { extract } from "@sermon-search/scripture"
import type { Kysely, SqlBool } from "kysely"
import { sql } from "kysely"
import { buildTsQuery } from "./build-tsquery.js"
import type { FtsResult } from "./fts.js"

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
  candidateLimit: number
  topicSlug?: string
  playlistSlug?: string
  publishedAfter?: Date
  publishedBefore?: Date
}

// Ref-mode pulls all videos whose scripture-ref intervals overlap the queried
// passage, ranks them by SUM(occurrences) of the matching refs, and returns
// every transcript_chunk in those videos that mentions the citation text. The
// route layer groups the chunks back into per-video result cards using the
// returned videoScores map as the video-level ranking signal.
export async function searchVideosByRef(
  db: Kysely<Database>,
  params: RefSearchParams,
): Promise<{ results: FtsResult[]; videoScores: Map<string, number> }> {
  const {
    startCoord,
    endCoord,
    rawQuery,
    candidateLimit,
    topicSlug,
    playlistSlug,
    publishedAfter,
    publishedBefore,
  } = params

  const overlapEnd = sql<SqlBool>`${endCoord} >= r.start_coord`
  const overlapStart = sql<SqlBool>`${startCoord} <= r.end_coord`

  let videosQuery = db
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

  if (topicSlug !== undefined) {
    const pred = sql<SqlBool>`v.id IN (SELECT vt.video_id FROM video_topics vt INNER JOIN topics t ON t.id = vt.topic_id WHERE t.slug = ${topicSlug})`
    videosQuery = videosQuery.where(pred)
  }

  if (playlistSlug !== undefined) {
    const pred = sql<SqlBool>`v.id IN (SELECT vp.video_id FROM video_playlists vp INNER JOIN playlists p ON p.id = vp.playlist_id WHERE p.slug = ${playlistSlug})`
    videosQuery = videosQuery.where(pred)
  }

  if (publishedAfter !== undefined) {
    videosQuery = videosQuery.where("v.published_at", ">=", publishedAfter)
  }

  if (publishedBefore !== undefined) {
    videosQuery = videosQuery.where("v.published_at", "<=", publishedBefore)
  }

  const videoRows = await videosQuery
    .groupBy(["v.id", "v.youtube_video_id", "v.title", "v.thumbnail_url"])
    .orderBy(sql`ref_score`, "desc")
    .limit(candidateLimit)
    .execute()

  if (videoRows.length === 0) {
    return { results: [], videoScores: new Map() }
  }

  const videoIds = videoRows.map((r) => r.id as string)
  const videoMeta = new Map<
    string,
    { youtube_video_id: string; title: string; thumbnail_url: string | null; ref_score: number }
  >()
  const videoScores = new Map<string, number>()
  for (const v of videoRows) {
    videoMeta.set(v.id as string, {
      youtube_video_id: v.youtube_video_id,
      title: v.title,
      thumbnail_url: v.thumbnail_url,
      ref_score: v.ref_score,
    })
    videoScores.set(v.youtube_video_id, v.ref_score)
  }

  const { tsquery } = buildTsQuery(rawQuery)
  const chunkRows = await db
    .selectFrom("transcript_chunks as c")
    .select([
      "c.video_id",
      "c.start_ms",
      "c.end_ms",
      sql<number>`ts_rank_cd(c.text_tsv, ${tsquery})`.as("chunk_score"),
      sql<string>`ts_headline('english', c.text, ${tsquery}, 'StartSel=<mark>,StopSel=</mark>,MaxFragments=1,MaxWords=20,MinWords=10')`.as(
        "snippet",
      ),
    ])
    .where("c.video_id", "in", videoIds)
    .where(sql<SqlBool>`c.text_tsv @@ ${tsquery}`)
    .orderBy("c.video_id", "asc")
    .orderBy("c.start_ms", "asc")
    .execute()

  const results: FtsResult[] = []
  for (const c of chunkRows) {
    const meta = videoMeta.get(c.video_id as string)
    if (!meta) continue
    results.push({
      youtube_video_id: meta.youtube_video_id,
      title: meta.title,
      thumbnail_url: meta.thumbnail_url,
      start_ms: Number(c.start_ms),
      end_ms: Number(c.end_ms),
      score: c.chunk_score,
      snippet: c.snippet,
      match_type: "lexical",
    })
  }

  return { results, videoScores }
}
