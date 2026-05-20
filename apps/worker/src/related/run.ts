import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { TOP_N_PER_SIGNAL, jaccard, pickQuotedSnippet, topN } from "./signals.js"

export interface RelatedBackfillOptions {
  db: Kysely<Database>
  force?: boolean
  log?: (msg: string) => void
}

export interface RelatedBackfillResult {
  videosProcessed: number
  videosSkipped: number
  rowsInserted: number
}

interface RelatedRow {
  related_video_id: string
  signal: string
  score: number
  payload: unknown
}

const EMBED_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small"

async function computeChunkSimilarity(
  db: Kysely<Database>,
  srcVideoId: string,
): Promise<RelatedRow[]> {
  const srcChunks = await db
    .selectFrom("transcript_chunks as tc")
    .innerJoin("embeddings as e", "e.chunk_id", "tc.id")
    .select(["tc.id", "tc.start_ms", "e.vector"])
    .where("tc.video_id", "=", srcVideoId)
    .where("e.model", "=", EMBED_MODEL)
    .execute()

  if (srcChunks.length === 0) return []

  const bestByRelated = new Map<
    string,
    { score: number; matchedStartMs: number; quotedText: string; srcStartMs: number }
  >()

  for (const chunk of srcChunks) {
    type NNRow = {
      related_video_id: string
      matched_start_ms: number
      matched_text: string
      distance: number
    }
    const { rows } = await sql<NNRow>`
      SELECT tc.video_id AS related_video_id,
             tc.start_ms AS matched_start_ms,
             tc.text     AS matched_text,
             (e.vector <=> ${chunk.vector}::vector) AS distance
      FROM embeddings e
      JOIN transcript_chunks tc ON tc.id = e.chunk_id
      WHERE e.model = ${EMBED_MODEL}
        AND tc.video_id <> ${srcVideoId}
      ORDER BY e.vector <=> ${chunk.vector}::vector ASC
      LIMIT ${TOP_N_PER_SIGNAL * 3}
    `.execute(db)

    for (const row of rows) {
      const score = 1 - row.distance
      const existing = bestByRelated.get(row.related_video_id)
      if (!existing || score > existing.score) {
        bestByRelated.set(row.related_video_id, {
          score,
          matchedStartMs: row.matched_start_ms,
          quotedText: pickQuotedSnippet(row.matched_text),
          srcStartMs: chunk.start_ms,
        })
      }
    }
  }

  return topN(
    [...bestByRelated.entries()].map(([related_video_id, data]) => ({
      related_video_id,
      signal: "chunk_similarity" as const,
      score: data.score,
      payload: {
        matched_chunk_start_ms: data.matchedStartMs,
        quoted_text: data.quotedText,
        source_chunk_start_ms: data.srcStartMs,
      },
    })),
  )
}

async function computeTopicOverlap(
  db: Kysely<Database>,
  srcVideoId: string,
  allVideoTopics: Map<string, string[]>,
): Promise<RelatedRow[]> {
  const srcTopics = allVideoTopics.get(srcVideoId) ?? []
  if (srcTopics.length === 0) return []

  const rows: RelatedRow[] = []
  for (const [videoId, topics] of allVideoTopics) {
    if (videoId === srcVideoId) continue
    const score = jaccard(srcTopics, topics)
    if (score < 0.1) continue
    const shared = srcTopics.filter((t) => topics.includes(t))
    rows.push({
      related_video_id: videoId,
      signal: "topic_overlap",
      score,
      payload: { topics: shared },
    })
  }

  return topN(rows)
}

async function computeScriptureOverlap(
  db: Kysely<Database>,
  srcVideoId: string,
  allVideoRefs: Map<string, string[]>,
): Promise<RelatedRow[]> {
  const srcRefs = allVideoRefs.get(srcVideoId) ?? []
  if (srcRefs.length === 0) return []

  const rows: RelatedRow[] = []
  for (const [videoId, refs] of allVideoRefs) {
    if (videoId === srcVideoId) continue
    const score = jaccard(srcRefs, refs)
    if (score < 0.1) continue
    const shared = srcRefs.filter((r) => refs.includes(r))
    rows.push({
      related_video_id: videoId,
      signal: "scripture_overlap",
      score,
      payload: { references: shared },
    })
  }

  return topN(rows)
}

async function computeSameSeries(db: Kysely<Database>, srcVideoId: string): Promise<RelatedRow[]> {
  type SeriesRow = {
    related_video_id: string
    playlist_id: string
    playlist_title: string
  }
  const rows = await sql<SeriesRow>`
    SELECT vp2.video_id AS related_video_id,
           p.id         AS playlist_id,
           p.title      AS playlist_title
    FROM video_playlists vp1
    JOIN video_playlists vp2 ON vp2.playlist_id = vp1.playlist_id
                             AND vp2.video_id <> ${srcVideoId}
    JOIN playlists p ON p.id = vp1.playlist_id
    WHERE vp1.video_id = ${srcVideoId}
    ORDER BY p.title, vp2.video_id
  `.execute(db)

  const seen = new Set<string>()
  const result: RelatedRow[] = []
  for (const row of rows.rows) {
    if (seen.has(row.related_video_id)) continue
    seen.add(row.related_video_id)
    result.push({
      related_video_id: row.related_video_id,
      signal: "same_series",
      score: 1.0,
      payload: { playlist_id: row.playlist_id, playlist_title: row.playlist_title },
    })
  }

  return topN(result)
}

export async function runRelatedBackfill({
  db,
  force = false,
  log = () => {},
}: RelatedBackfillOptions): Promise<RelatedBackfillResult> {
  const totals: RelatedBackfillResult = { videosProcessed: 0, videosSkipped: 0, rowsInserted: 0 }

  const videos = await db.selectFrom("videos").select(["id", "youtube_video_id"]).execute()

  // Pre-load all topic slugs and scripture refs for efficient in-app Jaccard
  const allTopicRows = await db
    .selectFrom("video_topics as vt")
    .innerJoin("topics as t", "t.id", "vt.topic_id")
    .select(["vt.video_id", "t.slug"])
    .execute()
  const allVideoTopics = new Map<string, string[]>()
  for (const row of allTopicRows) {
    const list = allVideoTopics.get(row.video_id) ?? []
    list.push(row.slug)
    allVideoTopics.set(row.video_id, list)
  }

  const allRefRows = await db
    .selectFrom("video_scripture_refs")
    .select(["video_id", "start_coord", "end_coord"])
    .execute()
  const allVideoRefs = new Map<string, string[]>()
  for (const row of allRefRows) {
    const list = allVideoRefs.get(row.video_id) ?? []
    list.push(`${row.start_coord}:${row.end_coord}`)
    allVideoRefs.set(row.video_id, list)
  }

  for (const video of videos) {
    const hasChunks = await db
      .selectFrom("transcript_chunks")
      .select("id")
      .where("video_id", "=", video.id)
      .limit(1)
      .executeTakeFirst()

    if (!hasChunks) {
      log(`skip ${video.youtube_video_id}: no chunks`)
      totals.videosSkipped++
      continue
    }

    if (!force) {
      const existing = await db
        .selectFrom("related_videos")
        .select("video_id")
        .where("video_id", "=", video.id)
        .limit(1)
        .executeTakeFirst()

      if (existing) {
        log(`skip ${video.youtube_video_id}: already computed`)
        totals.videosSkipped++
        continue
      }
    }

    log(`computing related for ${video.youtube_video_id}`)

    const [chunkRows, topicRows, scriptureRows, seriesRows] = await Promise.all([
      computeChunkSimilarity(db, video.id),
      computeTopicOverlap(db, video.id, allVideoTopics),
      computeScriptureOverlap(db, video.id, allVideoRefs),
      computeSameSeries(db, video.id),
    ])

    const allRows = [...chunkRows, ...topicRows, ...scriptureRows, ...seriesRows]

    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom("related_videos").where("video_id", "=", video.id).execute()

      if (allRows.length > 0) {
        await trx
          .insertInto("related_videos")
          .values(
            allRows.map((r) => ({
              video_id: video.id,
              related_video_id: r.related_video_id,
              signal: r.signal,
              score: r.score,
              payload: JSON.stringify(r.payload),
            })),
          )
          .execute()
      }
    })

    totals.rowsInserted += allRows.length
    totals.videosProcessed++
    log(`done ${video.youtube_video_id}: ${allRows.length} rows`)
  }

  return totals
}
