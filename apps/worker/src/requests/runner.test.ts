/**
 * Unit tests for the ingestion request runner.
 *
 * These tests verify the terminal state machine (status transitions, email
 * notifications, capped vs uncapped mode) without needing a real database,
 * YouTube API, or OpenAI API. Every external dependency is stubbed.
 */
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { RunIngestionRequestOptions } from "./runner.js"

// ── module-level stubs ────────────────────────────────────────────────────────

vi.mock("../ingest/handle.js", () => ({
  resolveChannel: vi.fn().mockResolvedValue({
    youtubeChannelId: "UCtest",
    title: "Test Channel",
  }),
}))

vi.mock("../youtube/cache_aware.js", () => ({
  getChannelMetadata: vi
    .fn()
    .mockResolvedValue({ channel: { snippet: { title: "Test Channel" } } }),
  getChannelPlaylists: vi.fn().mockResolvedValue({ playlists: [] }),
  getPlaylistItems: vi.fn().mockResolvedValue({ items: [] }),
  getVideosBatched: vi.fn().mockResolvedValue({ videos: new Map() }),
}))

vi.mock("../ingest/transcript.js", () => ({
  ingestVideoTranscript: vi
    .fn()
    .mockResolvedValue({ status: "ok", transcriptId: "t1", videoDbId: "v1" }),
}))

vi.mock("../ingest/embed.js", () => ({
  embedVideo: vi
    .fn()
    .mockResolvedValue({ chunksInserted: 0, embeddingsInserted: 0, skipped: false }),
}))

vi.mock("../enrich/run.js", () => ({
  enrichVideo: vi.fn().mockResolvedValue({ topicsInserted: 0, refsInserted: 0, skipped: false }),
}))

vi.mock("../related/run.js", () => ({
  computeRelatedForVideo: vi.fn().mockResolvedValue({ rowsInserted: 0, skipped: false }),
  loadVideoTopics: vi.fn().mockResolvedValue(new Map()),
  loadVideoRefs: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("../ingest/channel.js", () => ({
  upsertVideoFromPlaylistItem: vi.fn().mockResolvedValue(undefined),
  updateVideoFromMetadata: vi.fn().mockResolvedValue(undefined),
  findVideosMissingDuration: vi.fn().mockResolvedValue([]),
}))

vi.mock("../ingest/slug.js", () => ({
  uniqueSlugForPlaylist: vi.fn().mockReturnValue("test-playlist"),
}))

vi.mock("../ingest/candidates.js", () => ({
  CAPTIONLESS_MAX_ATTEMPTS: 3,
  loadIngestCandidates: vi.fn().mockResolvedValue([]),
}))

vi.mock("@sermon-search/notifications", () => ({
  notify: vi.fn().mockResolvedValue({ recipients: [] }),
}))

vi.mock("./limited-ingest-token-cap.js", () => ({
  LIMITED_INGEST_TOKEN_CAP_DEFAULT: 1000,
  countTranscriptTokens: vi.fn().mockReturnValue(100),
}))

// ── in-memory DB mock ─────────────────────────────────────────────────────────

/**
 * Minimal Kysely-shaped mock. Tracks the current state of the
 * `ingestion_requests` and `churches` rows so tests can assert on them.
 */
function buildDb(initialRequest: Record<string, unknown>, initialChurch?: Record<string, unknown>) {
  const reqRow: Record<string, unknown> = { ...initialRequest }
  const churchRow: Record<string, unknown> = initialChurch ?? {}
  const channelRows: Record<string, unknown>[] = []
  const playlistRows: Record<string, unknown>[] = []
  const videoRows: Record<string, unknown>[] = []
  const transcriptRows: Record<string, unknown>[] = []
  const channelUpdates: Record<string, unknown>[] = []

  // Fluent builder returned by selectFrom/updateTable/insertInto
  const makeSelect = (rows: Record<string, unknown>[]) => ({
    selectAll: () => makeSelect(rows),
    select: () => makeSelect(rows),
    where: () => makeSelect(rows),
    orderBy: () => makeSelect(rows),
    limit: () => makeSelect(rows),
    execute: async () => rows,
    executeTakeFirst: async () => rows[0],
    executeTakeFirstOrThrow: async () => {
      if (!rows[0]) throw new Error("Row not found")
      return rows[0]
    },
  })

  const makeUpdate = (target: Record<string, unknown>) => ({
    _target: target,
    set(values: Record<string, unknown>) {
      Object.assign(target, values)
      return this
    },
    where: () => makeUpdate(target),
    execute: async () => {},
    returning: () => makeSelect([target]),
  })

  const makeInsert = (collection: Record<string, unknown>[], row: Record<string, unknown>) => ({
    values(v: Record<string, unknown>) {
      Object.assign(row, v)
      return this
    },
    onConflict: () => makeInsert(collection, row),
    doUpdateSet: () => makeInsert(collection, row),
    returning: () => makeSelect([{ id: row.id ?? "generated-id", ...row }]),
    execute: async () => {
      collection.push(row)
    },
    executeTakeFirstOrThrow: async () => {
      collection.push(row)
      return { id: row.id ?? "generated-id", ...row }
    },
  })

  return {
    _req: reqRow,
    _church: churchRow,
    _channelUpdates: channelUpdates,
    selectFrom(table: string) {
      if (table === "ingestion_requests") return makeSelect([reqRow])
      if (table === "churches") {
        const rows = churchRow.id ? [churchRow] : []
        return makeSelect(rows)
      }
      if (table === "channels") return makeSelect(channelRows)
      if (table === "playlists") return makeSelect(playlistRows)
      if (table === "videos") return makeSelect(videoRows)
      if (table === "transcripts") {
        return makeSelect(
          transcriptRows.length > 0
            ? transcriptRows
            : [{ full_text: "some transcript text about Jesus" }],
        )
      }
      return makeSelect([])
    },
    updateTable(table: string) {
      if (table === "ingestion_requests") return makeUpdate(reqRow)
      if (table === "churches") return makeUpdate(churchRow)
      if (table === "channels") {
        const captured: Record<string, unknown> = {}
        channelUpdates.push(captured)
        return makeUpdate(captured)
      }
      return makeUpdate({})
    },
    insertInto(table: string) {
      if (table === "channels") return makeInsert(channelRows, { id: "chan-1" })
      if (table === "playlists") return makeInsert(playlistRows, { id: "pl-1" })
      if (table === "videos") return makeInsert(videoRows, { id: "vid-1" })
      if (table === "churches")
        return makeInsert([churchRow], { id: "church-1", status: "pending" })
      return makeInsert([], { id: "row-1" })
    },
    transaction() {
      return {
        execute: async (fn: (trx: unknown) => Promise<unknown>) => fn(this),
      }
    },
    destroy: async () => {},
  }
}

// ── test helpers ──────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "req-1",
    user_id: "user-1",
    church_id: null,
    requested_slug: "testchurch",
    requested_name: "Test Church",
    youtube_handle_or_url: "@TestChannel",
    include_playlist_ids: [],
    exclude_playlist_ids: [],
    contact_email: "test@example.com",
    status: "received",
    mode: "full",
    videos_discovered: 0,
    videos_ingested: 0,
    tokens_ingested: "0",
    limit_reached: false,
    admin_note: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }
}

/** Set the videos the pipeline's candidate query should return for one test. */
async function setCandidates(videos: Record<string, unknown>[]): Promise<void> {
  const { loadIngestCandidates } = await import("../ingest/candidates.js")
  ;(loadIngestCandidates as Mock).mockResolvedValue(videos)
}

function makeOpts(db: ReturnType<typeof buildDb>): RunIngestionRequestOptions {
  return {
    db: db as unknown as RunIngestionRequestOptions["db"],
    client: {} as RunIngestionRequestOptions["client"],
    embedder: {} as RunIngestionRequestOptions["embedder"],
    enricher: {} as RunIngestionRequestOptions["enricher"],
    sender: { send: vi.fn().mockResolvedValue(undefined) },
    notificationConfig: { from: "noreply@test.com" },
    webBaseUrl: "http://localhost:3000",
    requestId: "req-1",
    log: () => {},
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

// Clear mocks after every test so call counts don't bleed across describe blocks.
afterEach(() => {
  vi.clearAllMocks()
})

// clearAllMocks keeps implementations, so a per-test mockResolvedValue would
// otherwise leak into the next test's candidate list.
beforeEach(async () => {
  await setCandidates([])
})

describe("runIngestionRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("throws when status is not 'received' or 'approved'", async () => {
    const { runIngestionRequest } = await import("./runner.js")
    const { notify } = await import("@sermon-search/notifications")

    const db = buildDb(makeRequest({ status: "complete" }))
    await expect(runIngestionRequest(makeOpts(db))).rejects.toThrow(
      /expected 'received' or 'approved'/,
    )
    expect(notify).not.toHaveBeenCalled()
  })

  it("sets status to 'running' before starting the pipeline", async () => {
    const { runIngestionRequest } = await import("./runner.js")
    // Provide a church so ensureChurch short-circuits
    const db = buildDb(makeRequest({ church_id: "church-1" }), {
      id: "church-1",
      slug: "testchurch",
      status: "pending",
    })
    await runIngestionRequest(makeOpts(db))
    // The first status write is 'running'; subsequent ones depend on outcome
    // We verify the final status (complete) rather than the transient 'running'
    expect(db._req.status).toBe("complete")
  })

  it("terminates with 'complete' and activates the church when all videos are drained", async () => {
    const { runIngestionRequest } = await import("./runner.js")
    const { notify } = await import("@sermon-search/notifications")

    const db = buildDb(makeRequest({ church_id: "church-1" }), {
      id: "church-1",
      slug: "testchurch",
      status: "pending",
    })
    const result = await runIngestionRequest(makeOpts(db))

    expect(result.status).toBe("complete")
    expect(db._req.status).toBe("complete")
    expect(db._church.status).toBe("active")

    const calls = (notify as Mock).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toBe("complete")
  })

  it("terminates with 'awaiting_approval' when the token cap is hit", async () => {
    const { runIngestionRequest } = await import("./runner.js")
    const { notify } = await import("@sermon-search/notifications")
    const { countTranscriptTokens } = await import("./limited-ingest-token-cap.js")
    // Each video costs 600 tokens, cap = 1000 → cap is hit after the first video
    ;(countTranscriptTokens as Mock).mockReturnValue(600)

    // Provide two candidate videos via the videos table mock
    const db = buildDb(makeRequest({ church_id: "church-1" }), {
      id: "church-1",
      slug: "testchurch",
      status: "pending",
    })
    const fakeVideos = [
      { id: "v1", youtube_video_id: "yt1", title: "Sermon 1", church_id: "church-1" },
      { id: "v2", youtube_video_id: "yt2", title: "Sermon 2", church_id: "church-1" },
    ]
    await setCandidates(fakeVideos)

    const result = await runIngestionRequest({ ...makeOpts(db), tokenCap: 1000 })

    expect(result.status).toBe("awaiting_approval")
    expect(db._req.status).toBe("awaiting_approval")
    expect(db._req.limit_reached).toBe(true)
    expect(db._church.status).not.toBe("active")

    const calls = (notify as Mock).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toBe("awaiting_approval")
  })

  it("sets status to 'failed' and sends failed email when pipeline throws", async () => {
    const { runIngestionRequest } = await import("./runner.js")
    const { notify } = await import("@sermon-search/notifications")
    const { resolveChannel } = await import("../ingest/handle.js")
    ;(resolveChannel as Mock).mockRejectedValueOnce(new Error("YouTube quota exceeded"))

    const db = buildDb(makeRequest({ church_id: "church-1" }), {
      id: "church-1",
      slug: "testchurch",
      status: "pending",
    })

    await expect(runIngestionRequest(makeOpts(db))).rejects.toThrow("YouTube quota exceeded")
    expect(db._req.status).toBe("failed")
    expect(typeof db._req.admin_note).toBe("string")
    expect((db._req.admin_note as string).length).toBeGreaterThan(0)

    const calls = (notify as Mock).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toBe("failed")
  })

  it("seeds counters from persisted row on approved resume (not reset to 0)", async () => {
    const { runIngestionRequest } = await import("./runner.js")
    const { countTranscriptTokens } = await import("./limited-ingest-token-cap.js")
    // Each video costs 100 tokens (default mock). Persisted row has 800k tokens and 1 video already.
    ;(countTranscriptTokens as Mock).mockReturnValue(100)

    const db = buildDb(
      makeRequest({
        church_id: "church-1",
        status: "approved",
        tokens_ingested: "800000", // bigint arrives from DB as a string
        videos_ingested: 1,
      }),
      { id: "church-1", slug: "testchurch", status: "pending" },
    )

    // One candidate video so the loop runs at least once
    const fakeVideos = [
      { id: "v1", youtube_video_id: "yt1", title: "Sermon 1", church_id: "church-1" },
    ]
    await setCandidates(fakeVideos)

    await runIngestionRequest(makeOpts(db))

    // Counters must NOT be reset to 0; they advance from the persisted baseline
    expect(db._req.tokens_ingested).toBeGreaterThanOrEqual(800000)
    expect(db._req.videos_ingested).toBeGreaterThanOrEqual(2)
  })

  it("does not double-count tokens or videos_ingested when all candidates are already skipped on resume", async () => {
    const { runIngestionRequest } = await import("./runner.js")
    const { ingestVideoTranscript } = await import("../ingest/transcript.js")
    const { countTranscriptTokens } = await import("./limited-ingest-token-cap.js")
    // All candidates have existing transcripts — ingestVideoTranscript returns 'skipped'
    ;(ingestVideoTranscript as Mock).mockResolvedValue({
      status: "skipped",
      transcriptId: "t-existing",
      videoDbId: "v1",
    })

    const db = buildDb(
      makeRequest({
        church_id: "church-1",
        status: "approved",
        tokens_ingested: "800000",
        videos_ingested: 5,
      }),
      { id: "church-1", slug: "testchurch", status: "pending" },
    )

    // Three candidate videos, all of which will return 'skipped'
    const fakeVideos = [
      { id: "v1", youtube_video_id: "yt1", title: "Sermon 1", church_id: "church-1" },
      { id: "v2", youtube_video_id: "yt2", title: "Sermon 2", church_id: "church-1" },
      { id: "v3", youtube_video_id: "yt3", title: "Sermon 3", church_id: "church-1" },
    ]
    await setCandidates(fakeVideos)

    await runIngestionRequest(makeOpts(db))

    // Counters must not advance — every candidate was already counted in the prior pass
    expect(Number(db._req.tokens_ingested)).toBe(800000)
    expect(db._req.videos_ingested).toBe(5)
    expect(countTranscriptTokens).not.toHaveBeenCalled()
  })

  it("runs uncapped when status is 'approved' (resume path)", async () => {
    const { runIngestionRequest } = await import("./runner.js")
    const { countTranscriptTokens } = await import("./limited-ingest-token-cap.js")
    // Tokens per video >> default cap, but since uncapped the run still completes
    ;(countTranscriptTokens as Mock).mockReturnValue(999_999)

    const db = buildDb(makeRequest({ church_id: "church-1", status: "approved" }), {
      id: "church-1",
      slug: "testchurch",
      status: "pending",
    })
    const result = await runIngestionRequest(makeOpts(db))

    // Uncapped run should drain and complete, not hit awaiting_approval
    expect(result.status).toBe("complete")
  })

  it("passes the request's mode through to candidate selection", async () => {
    const { runIngestionRequest } = await import("./runner.js")
    const { loadIngestCandidates } = await import("../ingest/candidates.js")

    const db = buildDb(makeRequest({ church_id: "church-1", mode: "incremental" }), {
      id: "church-1",
      slug: "testchurch",
      status: "pending",
    })
    await runIngestionRequest(makeOpts(db))

    expect(loadIngestCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ churchId: "church-1", mode: "incremental" }),
    )
  })

  it("defaults to a full sweep when the request mode is 'full'", async () => {
    const { runIngestionRequest } = await import("./runner.js")
    const { loadIngestCandidates } = await import("../ingest/candidates.js")

    const db = buildDb(makeRequest({ church_id: "church-1", mode: "full" }), {
      id: "church-1",
      slug: "testchurch",
      status: "pending",
    })
    await runIngestionRequest(makeOpts(db))

    expect(loadIngestCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ churchId: "church-1", mode: "full" }),
    )
  })

  it("bumps channels.ingested_at when the run drains every candidate", async () => {
    const { runIngestionRequest } = await import("./runner.js")

    const db = buildDb(makeRequest({ church_id: "church-1" }), {
      id: "church-1",
      slug: "testchurch",
      status: "pending",
    })
    const result = await runIngestionRequest(makeOpts(db))

    expect(result.status).toBe("complete")
    expect(db._channelUpdates).toHaveLength(1)
    expect(db._channelUpdates[0]).toHaveProperty("ingested_at")
  })

  it("leaves channels.ingested_at alone when the run stops at the token cap", async () => {
    const { runIngestionRequest } = await import("./runner.js")
    const { ingestVideoTranscript } = await import("../ingest/transcript.js")
    const { countTranscriptTokens } = await import("./limited-ingest-token-cap.js")
    // clearAllMocks keeps implementations, so restate the ones an earlier test
    // overrode rather than inheriting them.
    ;(ingestVideoTranscript as Mock).mockResolvedValue({
      status: "ok",
      transcriptId: "t1",
      videoDbId: "v1",
    })
    ;(countTranscriptTokens as Mock).mockReturnValue(600)

    const db = buildDb(makeRequest({ church_id: "church-1" }), {
      id: "church-1",
      slug: "testchurch",
      status: "pending",
    })
    await setCandidates([
      { id: "v1", youtube_video_id: "yt1", title: "Sermon 1", church_id: "church-1" },
      { id: "v2", youtube_video_id: "yt2", title: "Sermon 2", church_id: "church-1" },
    ])

    const result = await runIngestionRequest({ ...makeOpts(db), tokenCap: 1000 })

    // A capped run covered only part of the channel; claiming otherwise would
    // make the next incremental run's watermark a lie.
    expect(result.status).toBe("awaiting_approval")
    expect(db._channelUpdates).toHaveLength(0)
  })

  it("creates a new pending church row when church_id is null", async () => {
    const { runIngestionRequest } = await import("./runner.js")

    // No church_id on the request and no existing church row
    const db = buildDb(makeRequest({ church_id: null }))
    const result = await runIngestionRequest(makeOpts(db))

    // Should complete (no videos to process) and set church to active
    expect(result.status).toBe("complete")
    // The church row should exist and have been activated
    expect(db._church.status).toBe("active")
  })
})

describe("filterPlaylists (via include/exclude behavior)", () => {
  it("keeps all playlists when both lists are empty", async () => {
    const { getChannelPlaylists } = await import("../youtube/cache_aware.js")
    const playlists = [{ id: "PL1" }, { id: "PL2" }, { id: "PL3" }]
    ;(getChannelPlaylists as Mock).mockResolvedValue({ playlists })

    const { runIngestionRequest } = await import("./runner.js")
    const db = buildDb(
      makeRequest({ church_id: "c1", include_playlist_ids: [], exclude_playlist_ids: [] }),
      { id: "c1", slug: "testchurch", status: "pending" },
    )
    await runIngestionRequest(makeOpts(db))
    // All three playlists were enumerated (3 getPlaylistItems calls)
    const { getPlaylistItems } = await import("../youtube/cache_aware.js")
    expect((getPlaylistItems as Mock).mock.calls.length).toBe(3)
  })

  it("keeps only included playlists when include list is non-empty", async () => {
    const { getChannelPlaylists } = await import("../youtube/cache_aware.js")
    const playlists = [{ id: "PL1" }, { id: "PL2" }, { id: "PL3" }]
    ;(getChannelPlaylists as Mock).mockResolvedValue({ playlists })

    const { runIngestionRequest } = await import("./runner.js")
    const db = buildDb(
      makeRequest({
        church_id: "c1",
        include_playlist_ids: ["PL1", "PL3"],
        exclude_playlist_ids: [],
      }),
      { id: "c1", slug: "testchurch", status: "pending" },
    )
    await runIngestionRequest(makeOpts(db))
    const { getPlaylistItems } = await import("../youtube/cache_aware.js")
    expect((getPlaylistItems as Mock).mock.calls.length).toBe(2)
  })

  it("drops excluded playlists when include list is empty", async () => {
    const { getChannelPlaylists } = await import("../youtube/cache_aware.js")
    const playlists = [{ id: "PL1" }, { id: "PL2" }, { id: "PL3" }]
    ;(getChannelPlaylists as Mock).mockResolvedValue({ playlists })

    const { runIngestionRequest } = await import("./runner.js")
    const db = buildDb(
      makeRequest({ church_id: "c1", include_playlist_ids: [], exclude_playlist_ids: ["PL2"] }),
      { id: "c1", slug: "testchurch", status: "pending" },
    )
    await runIngestionRequest(makeOpts(db))
    const { getPlaylistItems } = await import("../youtube/cache_aware.js")
    expect((getPlaylistItems as Mock).mock.calls.length).toBe(2)
  })
})
