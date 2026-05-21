import type { ScopedDb } from "@sermon-search/db"
import { display } from "@sermon-search/scripture"
import type { ScriptureRefDetail } from "@sermon-search/types"

const PER_RESULT_LIMIT = 6

export interface HydratedRefs {
  perVideo: Map<string, ScriptureRefDetail[]>
  aggregate: ScriptureRefDetail[]
}

function detailFromRow(r: {
  book_id: number
  chapter_start: number
  verse_start: number
  chapter_end: number
  verse_end: number
  start_coord: string | number | bigint
  end_coord: string | number | bigint
  occurrences: number
}): ScriptureRefDetail {
  const start_coord = Number(r.start_coord)
  const end_coord = Number(r.end_coord)
  return {
    book_id: r.book_id,
    chapter_start: r.chapter_start,
    verse_start: r.verse_start,
    chapter_end: r.chapter_end,
    verse_end: r.verse_end,
    start_coord,
    end_coord,
    occurrences: r.occurrences,
    display: display({
      book_id: r.book_id,
      chapter_start: r.chapter_start,
      verse_start: r.verse_start,
      chapter_end: r.chapter_end,
      verse_end: r.verse_end,
      start_coord,
      end_coord,
    }),
  }
}

export async function hydrateScriptureRefs(
  db: ScopedDb,
  youtubeVideoIds: string[],
): Promise<HydratedRefs> {
  if (youtubeVideoIds.length === 0) {
    return { perVideo: new Map(), aggregate: [] }
  }

  const rows = await db
    .selectFrom("video_scripture_refs as r")
    .innerJoin("videos as v", "v.id", "r.video_id")
    .select([
      "v.youtube_video_id",
      "r.book_id",
      "r.chapter_start",
      "r.verse_start",
      "r.chapter_end",
      "r.verse_end",
      "r.start_coord",
      "r.end_coord",
      "r.occurrences",
      "r.first_position",
    ])
    .where("v.youtube_video_id", "in", youtubeVideoIds)
    .where("v.church_id", "=", db.churchId)
    .orderBy("r.occurrences", "desc")
    .orderBy("r.first_position", "asc")
    .execute()

  const perVideo = new Map<string, ScriptureRefDetail[]>()
  const aggregateMap = new Map<string, ScriptureRefDetail>()

  for (const id of youtubeVideoIds) perVideo.set(id, [])

  for (const row of rows) {
    const detail = detailFromRow(row)
    const list = perVideo.get(row.youtube_video_id)
    if (list && list.length < PER_RESULT_LIMIT) list.push(detail)

    const key = `${detail.start_coord}:${detail.end_coord}`
    const existing = aggregateMap.get(key)
    if (existing) {
      existing.occurrences += detail.occurrences
    } else {
      aggregateMap.set(key, { ...detail })
    }
  }

  // Return every distinct ref aggregated across the returned videos so the UI
  // can guarantee that every per-card chip also appears in the page-level box.
  // The web layer is responsible for any visual truncation (e.g. show-more).
  const aggregate = Array.from(aggregateMap.values()).sort(
    (a, b) => b.occurrences - a.occurrences || a.start_coord - b.start_coord,
  )

  return { perVideo, aggregate }
}
