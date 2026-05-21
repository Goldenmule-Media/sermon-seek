import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"

export interface RechunkOptions {
  db: Kysely<Database>
  churchId: string
  log?: (msg: string) => void
}

export interface RechunkResult {
  transcriptsScanned: number
  chunksDeleted: number
}

/**
 * Delete all transcript_chunks for every transcript belonging to `churchId`.
 * Embeddings cascade via the embeddings_chunk_id_fk FK. The next `--embed`
 * run will rebuild chunks and re-embed.
 */
export async function runRechunk({
  db,
  churchId,
  log = () => {},
}: RechunkOptions): Promise<RechunkResult> {
  const totals: RechunkResult = { transcriptsScanned: 0, chunksDeleted: 0 }

  const transcripts = await db
    .selectFrom("transcripts")
    .innerJoin("videos", "videos.id", "transcripts.video_id")
    .select(["transcripts.id", "transcripts.video_id"])
    .where("videos.church_id", "=", churchId)
    .execute()

  for (const transcript of transcripts) {
    totals.transcriptsScanned++
    const deleted = await db
      .deleteFrom("transcript_chunks")
      .where("transcript_id", "=", transcript.id)
      .executeTakeFirst()
    const n = Number(deleted.numDeletedRows ?? 0)
    if (n > 0) {
      totals.chunksDeleted += n
      log(`rechunk transcript ${transcript.id}: deleted ${n} chunks`)
    }
  }

  return totals
}
