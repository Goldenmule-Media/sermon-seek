import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDb } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Spawner } from "../captions/fetch.js"
import { YT_DLP_VERSION } from "../captions/version.js"
import type { YoutubeClient } from "../youtube/client.js"
import type {
  ChannelsListResponse,
  PlaylistItemsListResponse,
  PlaylistsListResponse,
  VideosListResponse,
} from "../youtube/types.js"

const DATABASE_URL = process.env.DATABASE_URL
const describeIfDb = DATABASE_URL ? describe : describe.skip

const VIDEO_ID = "test_video_id_01"
const CHANNEL_ID = "UCTestTestTestTestTestTT"
const SAMPLE_VTT = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:03.000 align:start position:0%


00:00:03.000 --> 00:00:05.500 align:start position:0%
welcome<00:00:03.479><c> to</c><00:00:04.000><c> the</c><00:00:04.560><c> sermon</c>

00:00:05.500 --> 00:00:08.000 align:start position:0%
welcome to the sermon
today<00:00:05.760><c> we</c><00:00:06.000><c> read</c><00:00:06.799><c> from</c><00:00:07.359><c> John</c>
`

function makeFakeClient(): YoutubeClient {
  const client: Partial<YoutubeClient> = {
    listVideos: vi.fn(
      async (ids: readonly string[]): Promise<VideosListResponse> => ({
        items: ids.map((id) => ({
          id,
          snippet: {
            channelId: CHANNEL_ID,
            title: "Test Sermon",
            description: "A test sermon",
            publishedAt: "2025-01-01T00:00:00Z",
            thumbnails: {
              default: { url: "https://example.test/default.jpg" },
            },
          },
          contentDetails: {
            duration: "PT15S",
          },
        })),
      }),
    ),
    listChannelsById: vi.fn(
      async (id: string): Promise<ChannelsListResponse> => ({
        items: [
          {
            id,
            snippet: { title: "Test Channel" },
          },
        ],
      }),
    ),
    listChannelsByHandle: vi.fn(async (): Promise<ChannelsListResponse> => ({ items: [] })),
    listChannelsByUsername: vi.fn(async (): Promise<ChannelsListResponse> => ({ items: [] })),
    listPlaylists: vi.fn(async (): Promise<PlaylistsListResponse> => ({ items: [] })),
    listPlaylistItems: vi.fn(async (): Promise<PlaylistItemsListResponse> => ({ items: [] })),
  }
  return client as YoutubeClient
}

function makeFakeSpawner(): Spawner {
  return vi.fn(async ({ cwd }: { cwd: string }) => {
    await writeFile(join(cwd, `${VIDEO_ID}.en.vtt`), SAMPLE_VTT, "utf8")
    return { exitCode: 0, stderr: "" }
  })
}

describeIfDb("ingestVideoTranscript (integration)", () => {
  let tmpRoot: string
  let db: Kysely<Database>
  // biome-ignore lint/suspicious/noExplicitAny: dynamic ESM import for test environment.
  let ingestVideoTranscript: any

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "sermon-transcript-int-"))
    process.env.CACHE_DIR = tmpRoot
    vi.resetModules()
    const mod = await import("./transcript.js")
    ingestVideoTranscript = mod.ingestVideoTranscript
    db = createDb()
  })

  afterAll(async () => {
    await db.destroy()
    await rm(tmpRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await sql`TRUNCATE channels RESTART IDENTITY CASCADE`.execute(db)
  })

  it("first run inserts transcript/segments/words; second run is a no-op", async () => {
    const client = makeFakeClient()
    const spawner = makeFakeSpawner()

    const first = await ingestVideoTranscript({
      db,
      client,
      youtubeVideoId: VIDEO_ID,
      spawner,
    })
    expect(first.status).toBe("ok")
    expect(first.segmentCount).toBe(2)
    expect(first.wordCount).toBe(9)

    const transcriptRows = await db
      .selectFrom("transcripts")
      .selectAll()
      .where("video_id", "=", first.videoDbId)
      .execute()
    expect(transcriptRows).toHaveLength(1)
    expect(transcriptRows[0]?.model_version).toBe(YT_DLP_VERSION)
    expect(transcriptRows[0]?.source).toBe("youtube_public")
    expect(transcriptRows[0]?.full_text).toBe("welcome to the sermon today we read from John")
    expect(transcriptRows[0]?.raw_vtt).toBe(SAMPLE_VTT)

    const segmentRows = await db
      .selectFrom("transcript_segments")
      .selectAll()
      .where("video_id", "=", first.videoDbId)
      .orderBy("start_ms")
      .execute()
    expect(segmentRows).toHaveLength(2)

    const wordRows = await db
      .selectFrom("transcript_words")
      .selectAll()
      .where("video_id", "=", first.videoDbId)
      .orderBy("position")
      .execute()
    expect(wordRows).toHaveLength(9)

    // Every word's segment_id resolves and its start_ms falls within the segment's range.
    const segmentsById = new Map(segmentRows.map((s) => [s.id, s]))
    for (const w of wordRows) {
      const seg = segmentsById.get(w.segment_id)
      if (!seg) throw new Error(`no segment for word at ${w.start_ms}`)
      expect(w.start_ms).toBeGreaterThanOrEqual(seg.start_ms)
      expect(w.start_ms).toBeLessThanOrEqual(seg.end_ms)
    }

    // Second run: no-op. The fake spawner won't be called again because the
    // DB short-circuit fires before the caption fetch.
    const callsBefore = (spawner as ReturnType<typeof vi.fn>).mock.calls.length
    const second = await ingestVideoTranscript({
      db,
      client,
      youtubeVideoId: VIDEO_ID,
      spawner,
    })
    expect(second.status).toBe("skipped")
    expect(second.transcriptId).toBe(first.transcriptId)
    expect((spawner as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)

    const transcriptRowsAfter = await db
      .selectFrom("transcripts")
      .selectAll()
      .where("video_id", "=", first.videoDbId)
      .execute()
    expect(transcriptRowsAfter).toHaveLength(1)
  })
})
