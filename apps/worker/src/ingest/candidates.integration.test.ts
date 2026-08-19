/**
 * Integration tests for incremental-vs-full candidate selection against a real
 * Postgres database.
 *
 * The filter is pure SQL (a NOT EXISTS correlated subquery plus a bound on
 * captions_attempts), so a mocked query builder would only assert the shape of
 * the calls. These tests seed real rows and assert which ones come back.
 *
 * Requires TEST_DATABASE_URL to be set and pointing at a throwaway DB.
 */
import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { CAPTIONLESS_MAX_ATTEMPTS, loadIngestCandidates } from "./candidates.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

const CHANNEL_ID = "UCCandidatesIntTest0000"

describeIfDb("loadIngestCandidates (integration)", () => {
  let db: Kysely<Database>
  let churchId: string
  let channelDbId: string

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL")
    }
    await migrateToLatest(TEST_DATABASE_URL)
    db = createDb(TEST_DATABASE_URL)
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`TRUNCATE churches RESTART IDENTITY CASCADE`.execute(db)

    const church = await db
      .insertInto("churches")
      .values({
        slug: "candidates-int",
        name: "Candidates Int",
        youtube_channel_id: CHANNEL_ID,
        status: "active",
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    churchId = church.id

    const channel = await db
      .insertInto("channels")
      .values({
        church_id: churchId,
        youtube_channel_id: CHANNEL_ID,
        title: "Candidates Int Channel",
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    channelDbId = channel.id
  })

  async function insertVideo(
    youtubeVideoId: string,
    opts: { publishedAt: string; captionsAttempts?: number },
  ): Promise<string> {
    const row = await db
      .insertInto("videos")
      .values({
        church_id: churchId,
        channel_id: channelDbId,
        youtube_video_id: youtubeVideoId,
        title: `Sermon ${youtubeVideoId}`,
        published_at: opts.publishedAt,
        captions_attempts: opts.captionsAttempts ?? 0,
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()
    return row.id
  }

  async function insertTranscript(videoDbId: string): Promise<void> {
    await db
      .insertInto("transcripts")
      .values({
        video_id: videoDbId,
        source: "youtube_public",
        language: "en",
        model_version: "test",
        full_text: "a transcript",
        raw_vtt: "WEBVTT",
      })
      .execute()
  }

  it("full mode returns every discovered video, transcribed or not", async () => {
    const done = await insertVideo("cand_done", { publishedAt: "2025-01-01T00:00:00Z" })
    await insertTranscript(done)
    await insertVideo("cand_new", { publishedAt: "2025-02-01T00:00:00Z" })

    const candidates = await loadIngestCandidates({
      db,
      churchId,
      youtubeVideoIds: ["cand_done", "cand_new"],
      mode: "full",
    })

    expect(candidates.map((c) => c.youtube_video_id).sort()).toEqual(["cand_done", "cand_new"])
  })

  it("incremental mode returns only videos without a transcript", async () => {
    const done = await insertVideo("cand_done", { publishedAt: "2025-01-01T00:00:00Z" })
    await insertTranscript(done)
    await insertVideo("cand_new", { publishedAt: "2025-02-01T00:00:00Z" })

    const candidates = await loadIngestCandidates({
      db,
      churchId,
      youtubeVideoIds: ["cand_done", "cand_new"],
      mode: "incremental",
    })

    expect(candidates.map((c) => c.youtube_video_id)).toEqual(["cand_new"])
  })

  it("incremental mode picks up a video an earlier run missed, not just the newest", async () => {
    // An old video that never got a transcript is still 'not ingested yet', so
    // a published_at watermark would wrongly skip it forever.
    await insertVideo("cand_old_missed", { publishedAt: "2020-01-01T00:00:00Z" })
    const done = await insertVideo("cand_recent_done", { publishedAt: "2025-06-01T00:00:00Z" })
    await insertTranscript(done)

    const candidates = await loadIngestCandidates({
      db,
      churchId,
      youtubeVideoIds: ["cand_old_missed", "cand_recent_done"],
      mode: "incremental",
    })

    expect(candidates.map((c) => c.youtube_video_id)).toEqual(["cand_old_missed"])
  })

  it("incremental mode drops videos that hit the captionless retry ceiling", async () => {
    await insertVideo("cand_retry_left", {
      publishedAt: "2025-03-01T00:00:00Z",
      captionsAttempts: CAPTIONLESS_MAX_ATTEMPTS - 1,
    })
    await insertVideo("cand_exhausted", {
      publishedAt: "2025-03-02T00:00:00Z",
      captionsAttempts: CAPTIONLESS_MAX_ATTEMPTS,
    })

    const candidates = await loadIngestCandidates({
      db,
      churchId,
      youtubeVideoIds: ["cand_retry_left", "cand_exhausted"],
      mode: "incremental",
    })

    expect(candidates.map((c) => c.youtube_video_id)).toEqual(["cand_retry_left"])
  })

  it("full mode still retries videos that hit the captionless ceiling", async () => {
    await insertVideo("cand_exhausted", {
      publishedAt: "2025-03-02T00:00:00Z",
      captionsAttempts: CAPTIONLESS_MAX_ATTEMPTS + 5,
    })

    const candidates = await loadIngestCandidates({
      db,
      churchId,
      youtubeVideoIds: ["cand_exhausted"],
      mode: "full",
    })

    expect(candidates.map((c) => c.youtube_video_id)).toEqual(["cand_exhausted"])
  })

  it("returns newest first", async () => {
    await insertVideo("cand_older", { publishedAt: "2025-01-01T00:00:00Z" })
    await insertVideo("cand_newer", { publishedAt: "2025-09-01T00:00:00Z" })
    await insertVideo("cand_middle", { publishedAt: "2025-05-01T00:00:00Z" })

    const candidates = await loadIngestCandidates({
      db,
      churchId,
      youtubeVideoIds: ["cand_older", "cand_newer", "cand_middle"],
      mode: "incremental",
    })

    expect(candidates.map((c) => c.youtube_video_id)).toEqual([
      "cand_newer",
      "cand_middle",
      "cand_older",
    ])
  })

  it("scopes to the requesting church", async () => {
    await insertVideo("cand_mine", { publishedAt: "2025-01-01T00:00:00Z" })

    const otherChurch = await db
      .insertInto("churches")
      .values({
        slug: "candidates-int-other",
        name: "Other",
        youtube_channel_id: "UCCandidatesIntOther00",
        status: "active",
      })
      .returning(["id"])
      .executeTakeFirstOrThrow()

    const candidates = await loadIngestCandidates({
      db,
      churchId: otherChurch.id,
      youtubeVideoIds: ["cand_mine"],
      mode: "incremental",
    })

    expect(candidates).toEqual([])
  })

  it("returns nothing when the run discovered no videos", async () => {
    await insertVideo("cand_new", { publishedAt: "2025-02-01T00:00:00Z" })

    const candidates = await loadIngestCandidates({
      db,
      churchId,
      youtubeVideoIds: [],
      mode: "incremental",
    })

    expect(candidates).toEqual([])
  })
})
