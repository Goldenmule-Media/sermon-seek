import type { ScopedDb } from "@sermon-search/db"
import type { Topic } from "@sermon-search/types"

const PER_VIDEO_LIMIT = 8

export interface HydratedTopics {
  perVideo: Map<string, Topic[]>
  // Topics aggregated across the result page. `video_count` here means "how
  // many videos in this page are tagged with this topic" — not corpus-wide.
  aggregate: Topic[]
}

export async function hydrateTopics(
  db: ScopedDb,
  youtubeVideoIds: string[],
): Promise<HydratedTopics> {
  if (youtubeVideoIds.length === 0) {
    return { perVideo: new Map(), aggregate: [] }
  }

  const rows = await db
    .selectFrom("topics as t")
    .innerJoin("video_topics as vt", "vt.topic_id", "t.id")
    .innerJoin("videos as v", "v.id", "vt.video_id")
    .select(["v.youtube_video_id", "t.slug", "t.label", "vt.position"])
    .where("v.youtube_video_id", "in", youtubeVideoIds)
    .orderBy("vt.position", "asc")
    .execute()

  const perVideo = new Map<string, Topic[]>()
  const aggregateMap = new Map<string, Topic>()

  for (const id of youtubeVideoIds) perVideo.set(id, [])

  for (const row of rows) {
    const list = perVideo.get(row.youtube_video_id)
    if (list && list.length < PER_VIDEO_LIMIT) {
      list.push({ slug: row.slug, label: row.label, video_count: 1 })
    }

    const existing = aggregateMap.get(row.slug)
    if (existing) {
      existing.video_count += 1
    } else {
      aggregateMap.set(row.slug, {
        slug: row.slug,
        label: row.label,
        video_count: 1,
      })
    }
  }

  const aggregate = Array.from(aggregateMap.values()).sort(
    (a, b) => b.video_count - a.video_count || a.slug.localeCompare(b.slug),
  )

  return { perVideo, aggregate }
}
