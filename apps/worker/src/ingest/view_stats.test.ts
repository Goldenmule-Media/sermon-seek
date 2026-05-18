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

interface ChannelFixture {
  youtubeChannelId: string
  title: string
  playlists: PlaylistFixture[]
}

interface PlaylistFixture {
  youtubePlaylistId: string
  slug: string
  title: string
  videoIds: string[]
}

interface FakeClientState {
  channels: ChannelFixture[]
  viewCountByVideoId: Map<string, string | undefined>
}

function makeFakeClient(state: FakeClientState): YoutubeClient {
  const partial: Partial<YoutubeClient> = {
    listChannelsById: vi.fn(
      async (id: string): Promise<ChannelsListResponse> => ({
        items: [
          {
            id,
            snippet: { title: state.channels.find((c) => c.youtubeChannelId === id)?.title ?? id },
          },
        ],
      }),
    ),
    listChannelsByHandle: vi.fn(async (): Promise<ChannelsListResponse> => ({ items: [] })),
    listChannelsByUsername: vi.fn(async (): Promise<ChannelsListResponse> => ({ items: [] })),
    listPlaylists: vi.fn(async (channelId: string): Promise<PlaylistsListResponse> => {
      const channel = state.channels.find((c) => c.youtubeChannelId === channelId)
      return {
        items: (channel?.playlists ?? []).map((p) => ({
          id: p.youtubePlaylistId,
          snippet: { title: p.title, channelId },
          contentDetails: { itemCount: p.videoIds.length },
        })),
      }
    }),
    listPlaylistItems: vi.fn(async (playlistId: string): Promise<PlaylistItemsListResponse> => {
      for (const channel of state.channels) {
        const pl = channel.playlists.find((p) => p.youtubePlaylistId === playlistId)
        if (!pl) continue
        return {
          items: pl.videoIds.map((vid, i) => ({
            id: `${playlistId}-item-${i}`,
            contentDetails: { videoId: vid },
            snippet: { position: i, resourceId: { videoId: vid } },
          })),
        }
      }
      return { items: [] }
    }),
    listVideos: vi.fn(
      async (ids: readonly string[]): Promise<VideosListResponse> => ({
        items: ids.map((id) => {
          const viewCount = state.viewCountByVideoId.get(id)
          return {
            id,
            snippet: { title: `Video ${id}` },
            statistics: viewCount === undefined ? {} : { viewCount },
          }
        }),
      }),
    ),
  }
  return partial as YoutubeClient
}

async function seedFixture(db: Kysely<Database>, fixture: ChannelFixture[]): Promise<void> {
  for (const channel of fixture) {
    const channelRow = await db
      .insertInto("channels")
      .values({ youtube_channel_id: channel.youtubeChannelId, title: channel.title })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    const channelDbId = channelRow.id

    for (const playlist of channel.playlists) {
      const playlistRow = await db
        .insertInto("playlists")
        .values({
          channel_id: channelDbId,
          youtube_playlist_id: playlist.youtubePlaylistId,
          slug: playlist.slug,
          title: playlist.title,
          position: 0,
        })
        .returning(["id"])
        .executeTakeFirstOrThrow()
      const playlistDbId = playlistRow.id

      for (let i = 0; i < playlist.videoIds.length; i++) {
        const youtubeVideoId = playlist.videoIds[i]
        if (!youtubeVideoId) continue
        const existing = await db
          .selectFrom("videos")
          .select(["id"])
          .where("youtube_video_id", "=", youtubeVideoId)
          .executeTakeFirst()
        const videoDbId =
          existing?.id ??
          (
            await db
              .insertInto("videos")
              .values({
                channel_id: channelDbId,
                youtube_video_id: youtubeVideoId,
                title: `Video ${youtubeVideoId}`,
              })
              .returning(["id"])
              .executeTakeFirstOrThrow()
          ).id
        await db
          .insertInto("video_playlists")
          .values({ video_id: videoDbId, playlist_id: playlistDbId, position: i })
          .onConflict((oc) => oc.columns(["video_id", "playlist_id"]).doNothing())
          .execute()
      }
    }
  }
}

describeIfDb("runViewStats (aggregates)", () => {
  let tmpRoot: string
  let db: Kysely<Database>
  // biome-ignore lint/suspicious/noExplicitAny: dynamic ESM import for test environment.
  let runViewStats: any

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error(
        "TEST_DATABASE_URL must not equal DATABASE_URL — point it at a throwaway database (e.g. sermon_search_test)",
      )
    }
    await migrateToLatest(TEST_DATABASE_URL)
    tmpRoot = await mkdtemp(join(tmpdir(), "sermon-view-stats-unit-"))
    process.env.CACHE_DIR = tmpRoot
    vi.resetModules()
    const mod = await import("./view_stats.js")
    runViewStats = mod.runViewStats
    db = createDb(TEST_DATABASE_URL)
  })

  afterAll(async () => {
    await db.destroy()
    await rm(tmpRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await sql`TRUNCATE channels RESTART IDENTITY CASCADE`.execute(db)
  })

  it("writes total_views = SUM(member view_counts) and video_count = #members", async () => {
    const fixture: ChannelFixture[] = [
      {
        youtubeChannelId: "UCunit_one",
        title: "Channel One",
        playlists: [
          {
            youtubePlaylistId: "PLunit_one_a",
            slug: "channel-one-a",
            title: "Series A",
            videoIds: ["vA1", "vA2", "vA3"],
          },
          {
            youtubePlaylistId: "PLunit_one_b",
            slug: "channel-one-b",
            title: "Series B",
            videoIds: ["vB1"],
          },
        ],
      },
    ]
    await seedFixture(db, fixture)

    const viewCountByVideoId = new Map<string, string | undefined>([
      ["vA1", "10"],
      ["vA2", "20"],
      ["vA3", "30"],
      ["vB1", "100"],
    ])
    const client = makeFakeClient({ channels: fixture, viewCountByVideoId })

    const summary = await runViewStats({ db, client })
    expect(summary.channelCount).toBe(1)
    expect(summary.playlistCount).toBe(2)
    expect(summary.videoCount).toBe(4)

    const playlistA = await db
      .selectFrom("playlists")
      .select(["total_views", "video_count", "stats_updated_at"])
      .where("youtube_playlist_id", "=", "PLunit_one_a")
      .executeTakeFirstOrThrow()
    expect(playlistA.total_views).toBe("60")
    expect(playlistA.video_count).toBe(3)
    expect(playlistA.stats_updated_at).not.toBeNull()

    const playlistB = await db
      .selectFrom("playlists")
      .select(["total_views", "video_count", "stats_updated_at"])
      .where("youtube_playlist_id", "=", "PLunit_one_b")
      .executeTakeFirstOrThrow()
    expect(playlistB.total_views).toBe("100")
    expect(playlistB.video_count).toBe(1)
    expect(playlistB.stats_updated_at).not.toBeNull()

    const videoRows = await db
      .selectFrom("videos")
      .select(["youtube_video_id", "view_count", "view_count_updated_at"])
      .execute()
    for (const row of videoRows) {
      expect(row.view_count_updated_at).not.toBeNull()
      const expected = viewCountByVideoId.get(row.youtube_video_id)
      expect(row.view_count).toBe(expected ?? null)
    }
  })

  it("re-running refreshes counts and leaves row counts unchanged (idempotent)", async () => {
    const fixture: ChannelFixture[] = [
      {
        youtubeChannelId: "UCunit_two",
        title: "Channel Two",
        playlists: [
          {
            youtubePlaylistId: "PLunit_two",
            slug: "channel-two",
            title: "Series",
            videoIds: ["vT1", "vT2"],
          },
        ],
      },
    ]
    await seedFixture(db, fixture)

    const counts1 = new Map<string, string | undefined>([
      ["vT1", "5"],
      ["vT2", "7"],
    ])
    const client1 = makeFakeClient({ channels: fixture, viewCountByVideoId: counts1 })
    await runViewStats({ db, client: client1 })

    const playlistRowsBefore = await db.selectFrom("playlists").select(["id"]).execute()
    const videoRowsBefore = await db.selectFrom("videos").select(["id"]).execute()
    const joinRowsBefore = await db.selectFrom("video_playlists").select(["video_id"]).execute()

    const counts2 = new Map<string, string | undefined>([
      ["vT1", "11"],
      ["vT2", "13"],
    ])
    const client2 = makeFakeClient({ channels: fixture, viewCountByVideoId: counts2 })
    await runViewStats({ db, client: client2 })

    expect((await db.selectFrom("playlists").select(["id"]).execute()).length).toBe(
      playlistRowsBefore.length,
    )
    expect((await db.selectFrom("videos").select(["id"]).execute()).length).toBe(
      videoRowsBefore.length,
    )
    expect((await db.selectFrom("video_playlists").select(["video_id"]).execute()).length).toBe(
      joinRowsBefore.length,
    )

    const playlist = await db
      .selectFrom("playlists")
      .select(["total_views", "video_count"])
      .where("youtube_playlist_id", "=", "PLunit_two")
      .executeTakeFirstOrThrow()
    expect(playlist.total_views).toBe("24")
    expect(playlist.video_count).toBe(2)
  })

  it("treats missing statistics.viewCount as null (not 0) in aggregates", async () => {
    const fixture: ChannelFixture[] = [
      {
        youtubeChannelId: "UCunit_three",
        title: "Channel Three",
        playlists: [
          {
            youtubePlaylistId: "PLunit_three",
            slug: "channel-three",
            title: "Series",
            videoIds: ["vM1", "vM2"],
          },
        ],
      },
    ]
    await seedFixture(db, fixture)

    const counts = new Map<string, string | undefined>([
      ["vM1", "42"],
      ["vM2", undefined],
    ])
    const client = makeFakeClient({ channels: fixture, viewCountByVideoId: counts })
    await runViewStats({ db, client })

    const vM2 = await db
      .selectFrom("videos")
      .select(["view_count"])
      .where("youtube_video_id", "=", "vM2")
      .executeTakeFirstOrThrow()
    expect(vM2.view_count).toBeNull()

    const playlist = await db
      .selectFrom("playlists")
      .select(["total_views", "video_count"])
      .where("youtube_playlist_id", "=", "PLunit_three")
      .executeTakeFirstOrThrow()
    expect(playlist.total_views).toBe("42")
    expect(playlist.video_count).toBe(2)
  })
})
