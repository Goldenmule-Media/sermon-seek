import type { Database } from "@sermon-search/db"
import type { Kysely } from "kysely"
import { sql } from "kysely"

export const TEST_EMBEDDING_MODEL = "text-embedding-3-small"

const A_CHURCH_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const B_CHURCH_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
const A_CHANNEL_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001"
const B_CHANNEL_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000001"
const A_PLAYLIST_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000002"
const B_PLAYLIST_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000002"
// Two videos per church: one with a shared youtube_video_id (same id, different church_id
// rows — exercises the compound unique), one church-only.
const A_VIDEO_SHARED_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000003"
const A_VIDEO_ONLY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000004"
const B_VIDEO_SHARED_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000003"
const B_VIDEO_ONLY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000004"
const A_TRANSCRIPT_SHARED_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000005"
const A_TRANSCRIPT_ONLY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000006"
const B_TRANSCRIPT_SHARED_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000005"
const B_TRANSCRIPT_ONLY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000006"
const A_TOPIC_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000007"
const B_TOPIC_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000007"
// Explicit chunk IDs so embeddings can reference them via chunk_id FK.
const A_CHUNK_SHARED_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000008"
const A_CHUNK_ONLY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000009"
const B_CHUNK_SHARED_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000008"
const B_CHUNK_ONLY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000009"

// Shared youtube IDs — different church_id rows permitted by the compound uniques added in #860.
const SHARED_YOUTUBE_CHANNEL_ID = "UCsharedtest001"
const SHARED_YOUTUBE_PLAYLIST_ID = "PLsharedtest001"
const SHARED_YOUTUBE_VIDEO_ID = "ytSHARED0001"
const A_ONLY_YOUTUBE_VIDEO_ID = "ytAONLY0001"
const B_ONLY_YOUTUBE_VIDEO_ID = "ytBONLY0001"

// Deterministic 1536-d vector for pgvector. Alpha chunks use +1 at dim-0,
// Bravo chunks use -1. The test embedder always returns dim-0=+1 so Alpha
// chunks have cosine similarity +1 and Bravo chunks -1 for any query.
function mkVector(churchMarker: 1 | -1): string {
  const arr = new Array(1536).fill(0)
  arr[0] = churchMarker
  return `[${arr.join(",")}]`
}

export interface SeedResult {
  aSlug: string
  bSlug: string
  aId: string
  bId: string
  sharedYtVideoId: string
  aOnlyYtVideoId: string
  bOnlyYtVideoId: string
  aSharedTitle: string
  bSharedTitle: string
  sharedYtChannelId: string
  playlistSlug: string
  topicSlug: string
}

export async function seedChurches(db: Kysely<Database>): Promise<SeedResult> {
  await db
    .insertInto("churches")
    .values([
      { id: A_CHURCH_ID, slug: "alpha", name: "Alpha Church" },
      { id: B_CHURCH_ID, slug: "bravo", name: "Bravo Church" },
    ])
    .execute()

  // Both channels share the same youtube_channel_id — exercises the
  // (church_id, youtube_channel_id) compound unique from migration #860.
  await db
    .insertInto("channels")
    .values([
      {
        id: A_CHANNEL_ID,
        church_id: A_CHURCH_ID,
        youtube_channel_id: SHARED_YOUTUBE_CHANNEL_ID,
        title: "Alpha Channel",
      },
      {
        id: B_CHANNEL_ID,
        church_id: B_CHURCH_ID,
        youtube_channel_id: SHARED_YOUTUBE_CHANNEL_ID,
        title: "Bravo Channel",
      },
    ])
    .execute()

  // Both playlists share the same youtube_playlist_id.
  await db
    .insertInto("playlists")
    .values([
      {
        id: A_PLAYLIST_ID,
        channel_id: A_CHANNEL_ID,
        church_id: A_CHURCH_ID,
        youtube_playlist_id: SHARED_YOUTUBE_PLAYLIST_ID,
        slug: "sermons",
        title: "Alpha Sermons",
        position: 1,
      },
      {
        id: B_PLAYLIST_ID,
        channel_id: B_CHANNEL_ID,
        church_id: B_CHURCH_ID,
        youtube_playlist_id: SHARED_YOUTUBE_PLAYLIST_ID,
        slug: "sermons",
        title: "Bravo Sermons",
        position: 1,
      },
    ])
    .execute()

  // A_VIDEO_SHARED and B_VIDEO_SHARED share the same youtube_video_id.
  await db
    .insertInto("videos")
    .values([
      {
        id: A_VIDEO_SHARED_ID,
        channel_id: A_CHANNEL_ID,
        church_id: A_CHURCH_ID,
        youtube_video_id: SHARED_YOUTUBE_VIDEO_ID,
        title: "Alpha Sermon (shared id)",
        published_at: new Date("2024-01-01"),
      },
      {
        id: A_VIDEO_ONLY_ID,
        channel_id: A_CHANNEL_ID,
        church_id: A_CHURCH_ID,
        youtube_video_id: A_ONLY_YOUTUBE_VIDEO_ID,
        title: "Alpha Sermon (a-only)",
        published_at: new Date("2024-01-02"),
      },
      {
        id: B_VIDEO_SHARED_ID,
        channel_id: B_CHANNEL_ID,
        church_id: B_CHURCH_ID,
        youtube_video_id: SHARED_YOUTUBE_VIDEO_ID,
        title: "Bravo Sermon (shared id)",
        published_at: new Date("2024-01-01"),
      },
      {
        id: B_VIDEO_ONLY_ID,
        channel_id: B_CHANNEL_ID,
        church_id: B_CHURCH_ID,
        youtube_video_id: B_ONLY_YOUTUBE_VIDEO_ID,
        title: "Bravo Sermon (b-only)",
        published_at: new Date("2024-01-02"),
      },
    ])
    .execute()

  await db
    .insertInto("video_playlists")
    .values([
      { video_id: A_VIDEO_SHARED_ID, playlist_id: A_PLAYLIST_ID, position: 1 },
      { video_id: A_VIDEO_ONLY_ID, playlist_id: A_PLAYLIST_ID, position: 2 },
      { video_id: B_VIDEO_SHARED_ID, playlist_id: B_PLAYLIST_ID, position: 1 },
      { video_id: B_VIDEO_ONLY_ID, playlist_id: B_PLAYLIST_ID, position: 2 },
    ])
    .execute()

  // Transcripts make all four videos visible via videos_with_transcripts view.
  await db
    .insertInto("transcripts")
    .values([
      {
        id: A_TRANSCRIPT_SHARED_ID,
        video_id: A_VIDEO_SHARED_ID,
        source: "whisper",
        language: "en",
        full_text: "Alpha church sermon about grace and salvation",
      },
      {
        id: A_TRANSCRIPT_ONLY_ID,
        video_id: A_VIDEO_ONLY_ID,
        source: "whisper",
        language: "en",
        full_text: "Alpha church second sermon about grace and faith",
      },
      {
        id: B_TRANSCRIPT_SHARED_ID,
        video_id: B_VIDEO_SHARED_ID,
        source: "whisper",
        language: "en",
        full_text: "Bravo church sermon about grace and salvation",
      },
      {
        id: B_TRANSCRIPT_ONLY_ID,
        video_id: B_VIDEO_ONLY_ID,
        source: "whisper",
        language: "en",
        full_text: "Bravo church second sermon about grace and faith",
      },
    ])
    .execute()

  // Segments are needed by the transcript route and segment-start refinement.
  // text_tsv is GENERATED ALWAYS AS — omit from insert.
  await db
    .insertInto("transcript_segments")
    .values([
      {
        transcript_id: A_TRANSCRIPT_SHARED_ID,
        video_id: A_VIDEO_SHARED_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Alpha church sermon about grace and salvation",
      },
      {
        transcript_id: A_TRANSCRIPT_ONLY_ID,
        video_id: A_VIDEO_ONLY_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Alpha church second sermon about grace and faith",
      },
      {
        transcript_id: B_TRANSCRIPT_SHARED_ID,
        video_id: B_VIDEO_SHARED_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Bravo church sermon about grace and salvation",
      },
      {
        transcript_id: B_TRANSCRIPT_ONLY_ID,
        video_id: B_VIDEO_ONLY_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Bravo church second sermon about grace and faith",
      },
    ])
    .execute()

  // Chunks are the FTS and semantic search target.
  // text_tsv is GENERATED ALWAYS AS — omit from insert.
  // Explicit IDs so embeddings can reference them via the chunk_id FK.
  await db
    .insertInto("transcript_chunks")
    .values([
      {
        id: A_CHUNK_SHARED_ID,
        video_id: A_VIDEO_SHARED_ID,
        transcript_id: A_TRANSCRIPT_SHARED_ID,
        church_id: A_CHURCH_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Alpha church sermon about grace and salvation",
        position: 1,
      },
      {
        id: A_CHUNK_ONLY_ID,
        video_id: A_VIDEO_ONLY_ID,
        transcript_id: A_TRANSCRIPT_ONLY_ID,
        church_id: A_CHURCH_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Alpha church second sermon about grace and faith",
        position: 1,
      },
      {
        id: B_CHUNK_SHARED_ID,
        video_id: B_VIDEO_SHARED_ID,
        transcript_id: B_TRANSCRIPT_SHARED_ID,
        church_id: B_CHURCH_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Bravo church sermon about grace and salvation",
        position: 1,
      },
      {
        id: B_CHUNK_ONLY_ID,
        video_id: B_VIDEO_ONLY_ID,
        transcript_id: B_TRANSCRIPT_ONLY_ID,
        church_id: B_CHURCH_ID,
        start_ms: 0,
        end_ms: 30000,
        text: "Bravo church second sermon about grace and faith",
        position: 1,
      },
    ])
    .execute()

  // Embeddings for semantic/hybrid search. Alpha vectors have dim-0=+1,
  // Bravo vectors have dim-0=-1. The test embedder always returns dim-0=+1
  // so cosine similarity will be +1 for Alpha and -1 for Bravo — if ScopedDb
  // ever fails to filter by church_id, Bravo chunks would appear in A's results.
  const aVec = mkVector(1)
  const bVec = mkVector(-1)
  await sql`
    INSERT INTO embeddings (chunk_id, model, vector, church_id) VALUES
      (${A_CHUNK_SHARED_ID}, ${TEST_EMBEDDING_MODEL}, ${aVec}::vector, ${A_CHURCH_ID}),
      (${A_CHUNK_ONLY_ID},   ${TEST_EMBEDDING_MODEL}, ${aVec}::vector, ${A_CHURCH_ID}),
      (${B_CHUNK_SHARED_ID}, ${TEST_EMBEDDING_MODEL}, ${bVec}::vector, ${B_CHURCH_ID}),
      (${B_CHUNK_ONLY_ID},   ${TEST_EMBEDDING_MODEL}, ${bVec}::vector, ${B_CHURCH_ID})
  `.execute(db)

  // Topics use the church-scoped unique index — same slug in different churches is valid.
  await db
    .insertInto("topics")
    .values([
      { id: A_TOPIC_ID, church_id: A_CHURCH_ID, slug: "grace", label: "Grace" },
      { id: B_TOPIC_ID, church_id: B_CHURCH_ID, slug: "grace", label: "Grace" },
    ])
    .execute()

  await db
    .insertInto("video_topics")
    .values([
      { video_id: A_VIDEO_SHARED_ID, topic_id: A_TOPIC_ID, position: 1 },
      { video_id: A_VIDEO_ONLY_ID, topic_id: A_TOPIC_ID, position: 1 },
      { video_id: B_VIDEO_SHARED_ID, topic_id: B_TOPIC_ID, position: 1 },
      { video_id: B_VIDEO_ONLY_ID, topic_id: B_TOPIC_ID, position: 1 },
    ])
    .execute()

  // Related videos: shared→only within each church. Isolation is enforced in the
  // query by joining to videos_with_transcripts filtered by church_id.
  await db
    .insertInto("related_videos")
    .values([
      {
        video_id: A_VIDEO_SHARED_ID,
        related_video_id: A_VIDEO_ONLY_ID,
        signal: "topic_overlap",
        score: 0.8,
        payload: JSON.stringify({ topics: ["grace"] }),
      },
      {
        video_id: B_VIDEO_SHARED_ID,
        related_video_id: B_VIDEO_ONLY_ID,
        signal: "topic_overlap",
        score: 0.8,
        payload: JSON.stringify({ topics: ["grace"] }),
      },
    ])
    .execute()

  return {
    aSlug: "alpha",
    bSlug: "bravo",
    aId: A_CHURCH_ID,
    bId: B_CHURCH_ID,
    sharedYtVideoId: SHARED_YOUTUBE_VIDEO_ID,
    aOnlyYtVideoId: A_ONLY_YOUTUBE_VIDEO_ID,
    bOnlyYtVideoId: B_ONLY_YOUTUBE_VIDEO_ID,
    aSharedTitle: "Alpha Sermon (shared id)",
    bSharedTitle: "Bravo Sermon (shared id)",
    sharedYtChannelId: SHARED_YOUTUBE_CHANNEL_ID,
    playlistSlug: "sermons",
    topicSlug: "grace",
  }
}
