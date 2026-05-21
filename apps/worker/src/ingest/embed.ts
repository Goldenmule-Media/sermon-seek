import type { Database } from "@sermon-search/db"
import type { Embedder } from "@sermon-search/embeddings"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { chunkSegments } from "../chunking/chunk.js"

export interface EmbedBackfillOptions {
  db: Kysely<Database>
  embedder: Embedder
  churchId: string
  log?: (msg: string) => void
}

export interface EmbedBackfillResult {
  videosProcessed: number
  videosSkipped: number
  chunksInserted: number
  embeddingsInserted: number
}

export async function runEmbedBackfill({
  db,
  embedder,
  churchId,
  log = () => {},
}: EmbedBackfillOptions): Promise<EmbedBackfillResult> {
  const totals: EmbedBackfillResult = {
    videosProcessed: 0,
    videosSkipped: 0,
    chunksInserted: 0,
    embeddingsInserted: 0,
  }

  const videos = await db
    .selectFrom("videos")
    .select(["id", "youtube_video_id"])
    .where("church_id", "=", churchId)
    .execute()

  for (const video of videos) {
    const transcript = await db
      .selectFrom("transcripts")
      .select(["id"])
      .where("video_id", "=", video.id)
      .orderBy("created_at", "desc")
      .executeTakeFirst()

    if (!transcript) {
      log(`skip ${video.youtube_video_id}: no transcript`)
      continue
    }

    const segments = await db
      .selectFrom("transcript_segments")
      .selectAll()
      .where("transcript_id", "=", transcript.id)
      .orderBy("start_ms", "asc")
      .execute()

    if (segments.length === 0) {
      log(`skip ${video.youtube_video_id}: no segments`)
      continue
    }

    const existingChunks = await db
      .selectFrom("transcript_chunks")
      .select(["id"])
      .where("transcript_id", "=", transcript.id)
      .execute()

    const nChunks = existingChunks.length

    const nEmbeddings =
      nChunks > 0
        ? Number(
            (
              await db
                .selectFrom("embeddings")
                .select(db.fn.countAll<string>().as("count"))
                .where(
                  "chunk_id",
                  "in",
                  existingChunks.map((c) => c.id),
                )
                .where("model", "=", embedder.model)
                .executeTakeFirstOrThrow()
            ).count,
          )
        : 0

    if (nChunks > 0 && nChunks === nEmbeddings) {
      log(`skip ${video.youtube_video_id}: already embedded (${nChunks} chunks)`)
      totals.videosSkipped++
      continue
    }

    log(`processing ${video.youtube_video_id}`)

    await db.transaction().execute(async (trx) => {
      // Insert chunks if none exist yet (idempotent via unique constraint)
      if (nChunks === 0) {
        const newChunks = chunkSegments(segments)
        if (newChunks.length > 0) {
          const chunkRows = newChunks.map((chunk, position) => ({
            church_id: churchId,
            video_id: video.id,
            transcript_id: transcript.id,
            start_ms: chunk.start_ms,
            end_ms: chunk.end_ms,
            text: chunk.text,
            position,
          }))
          await trx
            .insertInto("transcript_chunks")
            .values(chunkRows)
            .onConflict((oc) => oc.columns(["transcript_id", "position"]).doNothing())
            .execute()
          totals.chunksInserted += chunkRows.length
        }
      }

      // Reload all chunks for this transcript
      const allChunks = await trx
        .selectFrom("transcript_chunks")
        .select(["id", "text"])
        .where("transcript_id", "=", transcript.id)
        .orderBy("position", "asc")
        .execute()

      if (allChunks.length === 0) return

      // Find chunks not yet embedded for this model
      const embeddedIds = new Set(
        (
          await trx
            .selectFrom("embeddings")
            .select("chunk_id")
            .where(
              "chunk_id",
              "in",
              allChunks.map((c) => c.id),
            )
            .where("model", "=", embedder.model)
            .execute()
        ).map((r) => r.chunk_id),
      )

      const toEmbed = allChunks.filter((c) => !embeddedIds.has(c.id))
      if (toEmbed.length === 0) return

      const vectors = await embedder.embed(toEmbed.map((c) => c.text))

      for (let i = 0; i < toEmbed.length; i++) {
        const chunkId = toEmbed[i]?.id
        const vec = `[${(vectors[i] as number[]).join(",")}]`
        await sql`
          INSERT INTO embeddings (chunk_id, model, vector, church_id)
          VALUES (${chunkId}, ${embedder.model}, ${vec}::vector, ${churchId})
          ON CONFLICT (chunk_id, model) DO NOTHING
        `.execute(trx)
      }

      totals.embeddingsInserted += toEmbed.length
    })

    totals.videosProcessed++
    log(`done ${video.youtube_video_id}`)
  }

  return totals
}
