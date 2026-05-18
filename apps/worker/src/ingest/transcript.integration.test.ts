import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDb, migrateToLatest } from "@sermon-search/db"
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

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

const VIDEO_ID = "test_video_id_01"
const OVERLAP_VIDEO_ID = "test_video_id_overlap"
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
// Demonstrates the YouTube cue-overlap quirk: the last inline timestamp of cue 1 (5500ms)
// equals cue 2's start_ms. The "overlap" word belongs to cue 1's segment.
const OVERLAP_VTT = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:03.000 align:start position:0%


00:00:03.000 --> 00:00:05.500 align:start position:0%
hello<00:00:03.200><c> world</c><00:00:05.500><c> overlap</c>

00:00:05.500 --> 00:00:08.000 align:start position:0%
hello world overlap
next<00:00:06.000><c> word</c>
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

function makeFakeSpawner(videoId: string, vttContent: string): Spawner {
  return vi.fn(async ({ cwd }: { cwd: string }) => {
    await writeFile(join(cwd, `${videoId}.en.vtt`), vttContent, "utf8")
    return { exitCode: 0, stderr: "" }
  })
}

describeIfDb("ingestVideoTranscript (integration)", () => {
  let tmpRoot: string
  let db: Kysely<Database>
  // biome-ignore lint/suspicious/noExplicitAny: dynamic ESM import for test environment.
  let ingestVideoTranscript: any

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error(
        "TEST_DATABASE_URL must not equal DATABASE_URL — point it at a throwaway database (e.g. sermon_search_test)",
      )
    }
    await migrateToLatest(TEST_DATABASE_URL)
    tmpRoot = await mkdtemp(join(tmpdir(), "sermon-transcript-int-"))
    process.env.CACHE_DIR = tmpRoot
    vi.resetModules()
    const mod = await import("./transcript.js")
    ingestVideoTranscript = mod.ingestVideoTranscript
    db = createDb(TEST_DATABASE_URL)
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
    const spawner = makeFakeSpawner(VIDEO_ID, SAMPLE_VTT)

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

    // Every word's segment_id resolves and its start_ms falls within [seg.start_ms, seg.end_ms).
    const segmentsById = new Map(segmentRows.map((s) => [s.id, s]))
    for (const w of wordRows) {
      const seg = segmentsById.get(w.segment_id)
      if (!seg) throw new Error(`no segment for word at ${w.start_ms}`)
      expect(w.start_ms).toBeGreaterThanOrEqual(seg.start_ms)
      expect(w.start_ms).toBeLessThan(seg.end_ms)
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

  it("cue-overlap: boundary word stays with the emitting cue's segment in the DB", async () => {
    const client = makeFakeClient()
    const spawner = makeFakeSpawner(OVERLAP_VIDEO_ID, OVERLAP_VTT)

    const result = await ingestVideoTranscript({
      db,
      client,
      youtubeVideoId: OVERLAP_VIDEO_ID,
      spawner,
    })
    expect(result.status).toBe("ok")
    expect(result.segmentCount).toBe(2)
    // hello, world, overlap, next, word
    expect(result.wordCount).toBe(5)

    const segmentRows = await db
      .selectFrom("transcript_segments")
      .selectAll()
      .where("video_id", "=", result.videoDbId)
      .orderBy("start_ms")
      .execute()
    expect(segmentRows).toHaveLength(2)
    const earlySegment = segmentRows.find((s) => s.start_ms === 3000)
    const lateSegment = segmentRows.find((s) => s.start_ms === 5500)
    expect(earlySegment).toBeDefined()
    expect(lateSegment).toBeDefined()

    const wordRows = await db
      .selectFrom("transcript_words")
      .selectAll()
      .where("video_id", "=", result.videoDbId)
      .orderBy("position")
      .execute()
    expect(wordRows).toHaveLength(5)

    // "overlap" word (start_ms=5500) must be assigned to the earlier segment (3000-5500),
    // not the later one (5500-8000). Parser grouping is authoritative; timestamp walk would
    // have incorrectly placed it in the later segment.
    const overlapWord = wordRows.find((w) => w.text === "overlap")
    expect(overlapWord, "overlap word should be in the DB").toBeDefined()
    expect(overlapWord?.segment_id).toBe(earlySegment?.id)

    // Every other word's segment_id should also be consistent with parser grouping.
    const segmentsById = new Map(segmentRows.map((s) => [s.id, s]))
    for (const w of wordRows) {
      const seg = segmentsById.get(w.segment_id)
      if (!seg) throw new Error(`no segment for word at position ${w.position}`)
      expect(w.start_ms).toBeGreaterThanOrEqual(seg.start_ms)
    }
  })
})
