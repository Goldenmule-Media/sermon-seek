import type { Database } from "@sermon-search/db"
import { extract } from "@sermon-search/scripture"
import type { Kysely } from "kysely"
import type { Enricher } from "./llm.js"
import { slugifyTopic } from "./topics.js"

export interface EnrichBackfillOptions {
  db: Kysely<Database>
  enricher: Enricher
  churchId: string
  force?: boolean
  log?: (msg: string) => void
}

export interface EnrichBackfillResult {
  videosProcessed: number
  videosSkipped: number
  topicsInserted: number
  refsInserted: number
}

export async function runEnrichBackfill({
  db,
  enricher,
  churchId,
  force = false,
  log = () => {},
}: EnrichBackfillOptions): Promise<EnrichBackfillResult> {
  const totals: EnrichBackfillResult = {
    videosProcessed: 0,
    videosSkipped: 0,
    topicsInserted: 0,
    refsInserted: 0,
  }

  const videos = await db
    .selectFrom("videos")
    .select(["id", "youtube_video_id", "title"])
    .where("church_id", "=", churchId)
    .execute()

  for (const video of videos) {
    const transcript = await db
      .selectFrom("transcripts")
      .select(["id", "full_text", "model_version"])
      .where("video_id", "=", video.id)
      .orderBy("created_at", "desc")
      .executeTakeFirst()

    if (!transcript) {
      log(`skip ${video.youtube_video_id}: no transcript`)
      continue
    }

    // Always extract and replace scripture refs regardless of enrichment state
    const refs = extract(transcript.full_text)
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom("video_scripture_refs").where("video_id", "=", video.id).execute()
      if (refs.length > 0) {
        await trx
          .insertInto("video_scripture_refs")
          .values(
            refs.map((ref) => ({
              video_id: video.id,
              book_id: ref.book_id,
              chapter_start: ref.chapter_start,
              verse_start: ref.verse_start,
              chapter_end: ref.chapter_end,
              verse_end: ref.verse_end,
              start_coord: ref.start_coord,
              end_coord: ref.end_coord,
              occurrences: ref.occurrences,
              positions: ref.positions,
              first_position: ref.first_position,
              raw_first: ref.raw_first,
            })),
          )
          .execute()
        totals.refsInserted += refs.length
      }
    })

    if (!force) {
      const existing = await db
        .selectFrom("video_enrichments")
        .select("video_id")
        .where("video_id", "=", video.id)
        .where("model_version", "=", enricher.model)
        .executeTakeFirst()

      if (existing) {
        log(`skip-llm ${video.youtube_video_id}: refs refreshed`)
        totals.videosSkipped++
        continue
      }
    }

    log(`enriching ${video.youtube_video_id}`)

    const output = await enricher.enrich(transcript.full_text, video.title)

    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto("video_enrichments")
        .values({
          video_id: video.id,
          summary: output.summary,
          model: enricher.model,
          model_version: enricher.model,
          raw_response: output as unknown,
        })
        .onConflict((oc) =>
          oc.column("video_id").doUpdateSet({
            summary: output.summary,
            model: enricher.model,
            model_version: enricher.model,
            raw_response: output as unknown,
            enriched_at: new Date(),
          }),
        )
        .execute()

      // Upsert topics and collect their ids
      const topicSlugs = output.topics.map(slugifyTopic).filter(Boolean)
      const uniqueSlugs = [...new Set(topicSlugs)]

      const topicIds: string[] = []
      for (const slug of uniqueSlugs) {
        const label = output.topics[topicSlugs.indexOf(slug)] ?? slug
        await trx
          .insertInto("topics")
          .values({ church_id: churchId, slug, label })
          .onConflict((oc) => oc.columns(["church_id", "slug"]).doNothing())
          .execute()

        const topic = await trx
          .selectFrom("topics")
          .select("id")
          .where("church_id", "=", churchId)
          .where("slug", "=", slug)
          .executeTakeFirstOrThrow()

        topicIds.push(topic.id)
      }

      // Replace video_topics
      await trx.deleteFrom("video_topics").where("video_id", "=", video.id).execute()
      if (topicIds.length > 0) {
        await trx
          .insertInto("video_topics")
          .values(
            topicIds.map((topic_id, position) => ({ video_id: video.id, topic_id, position })),
          )
          .execute()
        totals.topicsInserted += topicIds.length
      }
    })

    totals.videosProcessed++
    log(`done ${video.youtube_video_id}`)
  }

  return totals
}
