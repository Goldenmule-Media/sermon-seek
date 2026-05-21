import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import type { YoutubeClient } from "../youtube/client.js"
import { ingestVideoTranscript } from "./transcript.js"

export interface PollRssOptions {
  youtubeChannelId: string
  churchId: string
  db: Kysely<Database>
  client: YoutubeClient
}

export interface PollRssSummary {
  seen: number
  newIds: number
  ingested: number
}

const RSS_URL = (channelId: string) =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`

// YouTube's RSS feed returns at most ~15 entries. The <yt:videoId> element is
// stable and has appeared in this format since the feed was introduced.
function parseVideoIds(xml: string): string[] {
  const ids: string[] = []
  const re = /<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    ids.push(m[1])
  }
  return ids
}

export async function pollRssForNewUploads(opts: PollRssOptions): Promise<PollRssSummary> {
  const { youtubeChannelId, churchId, db, client } = opts

  const res = await fetch(RSS_URL(youtubeChannelId))
  if (!res.ok) {
    throw new Error(`RSS fetch failed: ${res.status} ${res.statusText} for channel ${youtubeChannelId}`)
  }
  const xml = await res.text()
  const feedIds = parseVideoIds(xml)

  if (feedIds.length === 0) {
    return { seen: 0, newIds: 0, ingested: 0 }
  }

  const existing = await db
    .selectFrom("videos")
    .select("youtube_video_id")
    .where("youtube_video_id", "in", feedIds)
    .execute()

  const existingSet = new Set(existing.map((r) => r.youtube_video_id))
  const toIngest = feedIds.filter((id) => !existingSet.has(id))

  let ingested = 0
  for (const youtubeVideoId of toIngest) {
    await ingestVideoTranscript({ db, client, youtubeVideoId, churchId })
    ingested++
  }

  return { seen: feedIds.length, newIds: toIngest.length, ingested }
}
