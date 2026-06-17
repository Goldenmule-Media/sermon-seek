import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { YoutubeClient } from "../youtube/client.js"
import type {
  ChannelsListResponse,
  PlaylistItemsListResponse,
  PlaylistsListResponse,
  VideosListResponse,
} from "../youtube/types.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

// Motivating case: New Horizon Church restricted to Sermons playlist
const CHANNEL_HANDLE = "@newhorizonchurchchampaigni2851"
const YT_CHANNEL_ID = "UCnewhorizon000000000001"

const SERMONS_PL_ID = "PLBG7MTmoGYojBL20TsURBq32EfhxcWq-2"
const ANNOUNCE_PL_ID = "PL_announcements0000000001"
const KIDS_PL_ID = "PL_kidsministry000000000001"

const PLAYLISTS = [
  { id: SERMONS_PL_ID, title: "Sermons", videoIds: ["vid_s1", "vid_s2"] },
  { id: ANNOUNCE_PL_ID, title: "Announcements", videoIds: ["vid_a1"] },
  { id: KIDS_PL_ID, title: "Kids Ministry", videoIds: ["vid_k1"] },
]

function makeClient(): YoutubeClient {
  const partial: Partial<YoutubeClient> = {
    listChannelsByHandle: vi.fn(
      async (): Promise<ChannelsListResponse> => ({
        items: [{ id: YT_CHANNEL_ID, snippet: { title: "New Horizon Church" } }],
      }),
    ),
    listChannelsByUsername: vi.fn(async (): Promise<ChannelsListResponse> => ({ items: [] })),
    listChannelsById: vi.fn(
      async (): Promise<ChannelsListResponse> => ({
        items: [{ id: YT_CHANNEL_ID, snippet: { title: "New Horizon Church" } }],
      }),
    ),
    listPlaylists: vi.fn(
      async (): Promise<PlaylistsListResponse> => ({
        items: PLAYLISTS.map((p, i) => ({
          id: p.id,
          snippet: { title: p.title, channelId: YT_CHANNEL_ID },
          contentDetails: { itemCount: p.videoIds.length },
        })),
      }),
    ),
    listPlaylistItems: vi.fn(async (playlistId: string): Promise<PlaylistItemsListResponse> => {
      const pl = PLAYLISTS.find((p) => p.id === playlistId)
      if (!pl) return { items: [] }
      return {
        items: pl.videoIds.map((vid, i) => ({
          id: `${playlistId}-item-${i}`,
          contentDetails: { videoId: vid },
          snippet: { position: i, resourceId: { videoId: vid } },
        })),
      }
    }),
    listVideos: vi.fn(
      async (ids: readonly string[]): Promise<VideosListResponse> => ({
        items: ids.map((id) => ({
          id,
          snippet: { title: `Video ${id}` },
          contentDetails: { duration: "PT10M" },
        })),
      }),
    ),
  }
  return partial as YoutubeClient
}

describeIfDb("ingestChannel filter rules (integration)", () => {
  let tmpRoot: string
  let db: Kysely<Database>
  let ingestChannel: (opts: {
    db: Kysely<Database>
    client: YoutubeClient
    handleOrId: string
    force?: boolean
  }) => Promise<{ channelId: string; playlistCount: number; videoCount: number }>

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error(
        "TEST_DATABASE_URL must not equal DATABASE_URL — point it at a throwaway database",
      )
    }
    await migrateToLatest(TEST_DATABASE_URL)
    tmpRoot = await mkdtemp(join(tmpdir(), "sermon-channel-int-"))
    process.env.CACHE_DIR = tmpRoot
    vi.resetModules()
    const mod = await import("./channel.js")
    ingestChannel = mod.ingestChannel
    db = createDb(TEST_DATABASE_URL)
  })

  afterAll(async () => {
    await db.destroy()
    await rm(tmpRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await sql`TRUNCATE channels RESTART IDENTITY CASCADE`.execute(db)
  })

  it("no rules → all playlists ingested, playlistCount = 3", async () => {
    const client = makeClient()
    const summary = await ingestChannel({ db, client, handleOrId: CHANNEL_HANDLE, force: true })
    expect(summary.playlistCount).toBe(3)
    expect(summary.videoCount).toBe(4)
    const plRows = await db
      .selectFrom("playlists")
      .select(["youtube_playlist_id"])
      .where("channel_id", "=", summary.channelId)
      .execute()
    expect(plRows.map((r) => r.youtube_playlist_id).sort()).toEqual(
      [SERMONS_PL_ID, ANNOUNCE_PL_ID, KIDS_PL_ID].sort(),
    )
    // All three playlists had their items fetched
    expect(client.listPlaylistItems).toHaveBeenCalledTimes(3)
  })

  it("allowlist: include rule → only Sermons playlist ingested, others skipped", async () => {
    // First call establishes the channel row so we can seed a rule
    const setupClient = makeClient()
    const setup = await ingestChannel({
      db,
      client: setupClient,
      handleOrId: CHANNEL_HANDLE,
      force: true,
    })

    // Seed the include rule
    await db
      .insertInto("channel_filter_rules")
      .values({
        channel_id: setup.channelId,
        rule_type: "include",
        target_kind: "playlist",
        target_id: SERMONS_PL_ID,
      })
      .execute()

    // Second call with fresh mock — force: true bypasses cache
    const client = makeClient()
    const summary = await ingestChannel({
      db,
      client,
      handleOrId: CHANNEL_HANDLE,
      force: true,
    })

    expect(summary.playlistCount).toBe(1)

    const plRows = await db
      .selectFrom("playlists")
      .innerJoin("channels", "channels.id", "playlists.channel_id")
      .select(["playlists.youtube_playlist_id", "playlists.title"])
      .where("channels.youtube_channel_id", "=", YT_CHANNEL_ID)
      .execute()
    // All three rows from the first pass remain; the filter does not delete or re-upsert
    // the excluded ones (DB-level assertion that they were not re-touched)
    const secondRunPlaylistIds = plRows.map((r) => r.youtube_playlist_id)
    expect(plRows).toHaveLength(3)
    expect(secondRunPlaylistIds).toContain(SERMONS_PL_ID)
    expect(secondRunPlaylistIds).toContain(ANNOUNCE_PL_ID)
    expect(secondRunPlaylistIds).toContain(KIDS_PL_ID)
    expect(plRows.find((r) => r.youtube_playlist_id === ANNOUNCE_PL_ID)?.title).toBe(
      "Announcements",
    )
    expect(plRows.find((r) => r.youtube_playlist_id === KIDS_PL_ID)?.title).toBe("Kids Ministry")

    // listPlaylistItems must NOT have been called for the filtered-out playlists
    const itemCalls = (client.listPlaylistItems as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    )
    expect(itemCalls).not.toContain(ANNOUNCE_PL_ID)
    expect(itemCalls).not.toContain(KIDS_PL_ID)
    expect(itemCalls).toContain(SERMONS_PL_ID)

    // Video count reflects only the sermons playlist videos
    expect(summary.videoCount).toBe(2)
  })

  it("denylist: exclude rule → excluded playlist skipped, others ingested", async () => {
    // Establish channel row
    const setupClient = makeClient()
    const setup = await ingestChannel({
      db,
      client: setupClient,
      handleOrId: CHANNEL_HANDLE,
      force: true,
    })

    // Seed exclude rule for Announcements
    await db
      .insertInto("channel_filter_rules")
      .values({
        channel_id: setup.channelId,
        rule_type: "exclude",
        target_kind: "playlist",
        target_id: ANNOUNCE_PL_ID,
      })
      .execute()

    const client = makeClient()
    const summary = await ingestChannel({
      db,
      client,
      handleOrId: CHANNEL_HANDLE,
      force: true,
    })

    expect(summary.playlistCount).toBe(2)

    // listPlaylistItems must NOT have been called for the excluded playlist
    const itemCalls = (client.listPlaylistItems as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    )
    expect(itemCalls).not.toContain(ANNOUNCE_PL_ID)
    expect(itemCalls).toContain(SERMONS_PL_ID)
    expect(itemCalls).toContain(KIDS_PL_ID)

    // 3 videos (2 from sermons + 1 from kids), since announcements was excluded
    expect(summary.videoCount).toBe(3)
  })
})
