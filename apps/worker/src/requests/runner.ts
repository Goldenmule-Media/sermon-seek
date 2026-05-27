import type { Database } from "@sermon-search/db"
import type { Embedder } from "@sermon-search/embeddings"
import type { EmailSender, NotificationConfig } from "@sermon-search/notifications"
import { notify } from "@sermon-search/notifications"
import type { IngestionRequest } from "@sermon-search/types"
import { type Kysely, sql } from "kysely"
import { enrichVideo } from "../enrich/run.js"
import { embedVideo } from "../ingest/embed.js"
import {
  findVideosMissingDuration,
  updateVideoFromMetadata,
  upsertVideoFromPlaylistItem,
} from "../ingest/channel.js"
import { resolveChannel } from "../ingest/handle.js"
import { uniqueSlugForPlaylist } from "../ingest/slug.js"
import { ingestVideoTranscript } from "../ingest/transcript.js"
import {
  computeRelatedForVideo,
  loadVideoRefs,
  loadVideoTopics,
} from "../related/run.js"
import { countTranscriptTokens, LIMITED_INGEST_TOKEN_CAP_DEFAULT } from "./limited-ingest-token-cap.js"
import type { Enricher } from "../enrich/llm.js"
import {
  getChannelMetadata,
  getChannelPlaylists,
  getPlaylistItems,
  getVideosBatched,
} from "../youtube/cache_aware.js"
import type { YoutubeClient } from "../youtube/client.js"
import type { YoutubePlaylistItem } from "../youtube/types.js"

export interface RunIngestionRequestOptions {
  db: Kysely<Database>
  client: YoutubeClient
  embedder: Embedder
  enricher: Enricher
  sender: EmailSender
  notificationConfig: NotificationConfig
  webBaseUrl: string
  requestId: string
  tokenCap?: number
  log?: (msg: string) => void
}

export interface RunIngestionRequestResult {
  status: "complete" | "awaiting_approval"
  videosDiscovered: number
  videosIngested: number
  tokensIngested: number
}

function searchUrlFor(webBaseUrl: string, slug: string): string {
  return `${webBaseUrl}/${slug}/`
}

async function reloadRequest(db: Kysely<Database>, requestId: string): Promise<IngestionRequest> {
  const row = await db
    .selectFrom("ingestion_requests")
    .selectAll()
    .where("id", "=", requestId)
    .executeTakeFirstOrThrow()
  return {
    ...row,
    tokens_ingested: Number(row.tokens_ingested),
    include_playlist_ids: row.include_playlist_ids as string[],
    exclude_playlist_ids: row.exclude_playlist_ids as string[],
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    admin_note: row.admin_note ?? null,
    church_id: row.church_id ?? null,
  }
}

export async function runIngestionRequest({
  db,
  client,
  embedder,
  enricher,
  sender,
  notificationConfig,
  webBaseUrl,
  requestId,
  tokenCap,
  log = () => {},
}: RunIngestionRequestOptions): Promise<RunIngestionRequestResult> {
  const request = await reloadRequest(db, requestId)

  const capped = request.status === "received"
  const uncapped = request.status === "approved"
  if (!capped && !uncapped) {
    throw new Error(
      `Cannot run request ${requestId}: status is '${request.status}' (expected 'received' or 'approved')`,
    )
  }
  const cap = capped ? (tokenCap ?? LIMITED_INGEST_TOKEN_CAP_DEFAULT) : Number.POSITIVE_INFINITY

  await db
    .updateTable("ingestion_requests")
    .set({ status: "running", updated_at: sql`now()` })
    .where("id", "=", requestId)
    .execute()

  try {
    const result = await runPipeline({
      db,
      client,
      embedder,
      enricher,
      request,
      cap,
      log,
    })

    const finalRequest = await reloadRequest(db, requestId)
    const searchUrl = finalRequest.church_id
      ? await getSlugSearchUrl(db, webBaseUrl, finalRequest.church_id)
      : null

    if (result.capHit) {
      await db
        .updateTable("ingestion_requests")
        .set({ status: "awaiting_approval", limit_reached: true, updated_at: sql`now()` })
        .where("id", "=", requestId)
        .execute()
      const updatedRequest = await reloadRequest(db, requestId)
      await notify(
        sender,
        "awaiting_approval",
        { request: updatedRequest, webBaseUrl, searchUrl: searchUrl ?? "" },
        notificationConfig,
      )
      return {
        status: "awaiting_approval",
        videosDiscovered: updatedRequest.videos_discovered,
        videosIngested: updatedRequest.videos_ingested,
        tokensIngested: updatedRequest.tokens_ingested,
      }
    }

    if (finalRequest.church_id) {
      await db
        .updateTable("churches")
        .set({ status: "active" })
        .where("id", "=", finalRequest.church_id)
        .execute()
    }
    await db
      .updateTable("ingestion_requests")
      .set({ status: "complete", updated_at: sql`now()` })
      .where("id", "=", requestId)
      .execute()
    const completedRequest = await reloadRequest(db, requestId)
    await notify(
      sender,
      "complete",
      { request: completedRequest, webBaseUrl, searchUrl: searchUrl ?? "" },
      notificationConfig,
    )
    return {
      status: "complete",
      videosDiscovered: completedRequest.videos_discovered,
      videosIngested: completedRequest.videos_ingested,
      tokensIngested: completedRequest.tokens_ingested,
    }
  } catch (err) {
    const note = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500)
    await db
      .updateTable("ingestion_requests")
      .set({ status: "failed", admin_note: note, updated_at: sql`now()` })
      .where("id", "=", requestId)
      .execute()
    try {
      const failedRequest = await reloadRequest(db, requestId)
      const searchUrl = failedRequest.church_id
        ? await getSlugSearchUrl(db, webBaseUrl, failedRequest.church_id)
        : null
      await notify(
        sender,
        "failed",
        { request: failedRequest, webBaseUrl, searchUrl: searchUrl ?? "" },
        notificationConfig,
      )
    } catch {
      // best-effort; don't mask the original error
    }
    throw err
  }
}

async function getSlugSearchUrl(
  db: Kysely<Database>,
  webBaseUrl: string,
  churchId: string,
): Promise<string> {
  const church = await db
    .selectFrom("churches")
    .select("slug")
    .where("id", "=", churchId)
    .executeTakeFirst()
  return church ? searchUrlFor(webBaseUrl, church.slug) : ""
}

interface PipelineResult {
  capHit: boolean
}

async function runPipeline({
  db,
  client,
  embedder,
  enricher,
  request,
  cap,
  log,
}: {
  db: Kysely<Database>
  client: YoutubeClient
  embedder: Embedder
  enricher: Enricher
  request: IngestionRequest
  cap: number
  log: (msg: string) => void
}): Promise<PipelineResult> {
  // Step 2: Resolve channel
  const resolved = await resolveChannel(client, request.youtube_handle_or_url)
  log(`resolved channel ${resolved.youtubeChannelId}: ${resolved.title}`)

  // Ensure churches row exists and is linked
  const churchId = await ensureChurch(db, request, resolved.youtubeChannelId, resolved.title)

  // Upsert channels row
  const { channel } = await getChannelMetadata(client, resolved.youtubeChannelId)
  const channelTitle = channel.snippet?.title ?? resolved.title
  const channelRow = await db
    .insertInto("channels")
    .values({ church_id: churchId, youtube_channel_id: resolved.youtubeChannelId, title: channelTitle })
    .onConflict((oc) =>
      oc.columns(["church_id", "youtube_channel_id"]).doUpdateSet({ title: channelTitle }),
    )
    .returning(["id"])
    .executeTakeFirstOrThrow()
  const channelDbId = channelRow.id
  log(`upserted channel row ${channelDbId}`)

  // Step 3: Enumerate playlists with include/exclude filtering
  const { playlists: rawPlaylists } = await getChannelPlaylists(client, resolved.youtubeChannelId)
  const playlists = filterPlaylists(
    rawPlaylists,
    request.include_playlist_ids,
    request.exclude_playlist_ids,
  )
  log(`${playlists.length}/${rawPlaylists.length} playlists after filtering`)

  // Persist playlist rows
  const existingPlaylistRows = await db
    .selectFrom("playlists")
    .select(["youtube_playlist_id", "slug"])
    .where("channel_id", "=", channelDbId)
    .execute()
  const existingSlugByPlaylistId = new Map(existingPlaylistRows.map((r) => [r.youtube_playlist_id, r.slug]))
  const takenSlugs = new Set(existingPlaylistRows.map((r) => r.slug))
  const positionByPlaylistId = new Map(playlists.map((pl, i) => [pl.id, i]))
  const sortedPlaylists = [...playlists].sort((a, b) => a.id.localeCompare(b.id))
  const playlistDbIds = new Map<string, string>()
  for (const pl of sortedPlaylists) {
    const title = pl.snippet?.title ?? "(untitled playlist)"
    const position = positionByPlaylistId.get(pl.id) ?? 0
    let slug = existingSlugByPlaylistId.get(pl.id)
    if (slug === undefined) {
      slug = uniqueSlugForPlaylist(title, pl.id, takenSlugs)
      takenSlugs.add(slug)
    }
    const plRow = await db
      .insertInto("playlists")
      .values({
        church_id: churchId,
        channel_id: channelDbId,
        youtube_playlist_id: pl.id,
        slug,
        title,
        description: pl.snippet?.description ?? null,
        position,
        video_count: pl.contentDetails?.itemCount ?? null,
      })
      .onConflict((oc) =>
        oc.columns(["church_id", "youtube_playlist_id"]).doUpdateSet({
          channel_id: channelDbId,
          slug,
          title,
          description: pl.snippet?.description ?? null,
          position,
          video_count: pl.contentDetails?.itemCount ?? null,
        }),
      )
      .returning(["id"])
      .executeTakeFirstOrThrow()
    playlistDbIds.set(pl.id, plRow.id)
  }

  // Step 4: Enumerate videos (deduped)
  const videoFirstSeen = new Map<string, YoutubePlaylistItem>()
  const joinRows: Array<{ youtubeVideoId: string; youtubePlaylistId: string; position: number }> = []

  for (const pl of playlists) {
    const { items } = await getPlaylistItems(client, resolved.youtubeChannelId, pl.id)
    for (const item of items) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId
      if (!videoId) continue
      joinRows.push({ youtubeVideoId: videoId, youtubePlaylistId: pl.id, position: item.snippet?.position ?? 0 })
      if (!videoFirstSeen.has(videoId)) videoFirstSeen.set(videoId, item)
    }
  }

  // Upsert video + video_playlists rows
  await db.transaction().execute(async (trx) => {
    for (const [videoId, item] of videoFirstSeen) {
      await upsertVideoFromPlaylistItem(trx, channelDbId, churchId, videoId, item)
    }
    const youtubeVideoIds = Array.from(videoFirstSeen.keys())
    const videoDbIdByYoutubeId = new Map<string, string>()
    if (youtubeVideoIds.length > 0) {
      const rows = await trx
        .selectFrom("videos")
        .select(["id", "youtube_video_id"])
        .where("youtube_video_id", "in", youtubeVideoIds)
        .execute()
      for (const r of rows) videoDbIdByYoutubeId.set(r.youtube_video_id, r.id)
    }
    for (const row of joinRows) {
      const videoDbId = videoDbIdByYoutubeId.get(row.youtubeVideoId)
      const playlistDbId = playlistDbIds.get(row.youtubePlaylistId)
      if (!videoDbId || !playlistDbId) continue
      await trx
        .insertInto("video_playlists")
        .values({ video_id: videoDbId, playlist_id: playlistDbId, position: row.position })
        .onConflict((oc) => oc.columns(["video_id", "playlist_id"]).doUpdateSet({ position: row.position }))
        .execute()
    }
  })

  // Backfill missing durations
  const allYoutubeIds = Array.from(videoFirstSeen.keys())
  const idsMissingDuration = await findVideosMissingDuration(db, allYoutubeIds)
  if (idsMissingDuration.length > 0) {
    const { videos } = await getVideosBatched(client, idsMissingDuration)
    await db.transaction().execute(async (trx) => {
      for (const ytId of idsMissingDuration) {
        const video = videos.get(ytId)
        if (!video) continue
        await updateVideoFromMetadata(trx, ytId, video)
      }
    })
  }

  // Set videos_discovered
  const totalDiscovered = videoFirstSeen.size
  await db
    .updateTable("ingestion_requests")
    .set({ videos_discovered: totalDiscovered, updated_at: sql`now()` })
    .where("id", "=", request.id)
    .execute()
  log(`videos_discovered = ${totalDiscovered}`)

  // Step 5: Load candidate videos ordered by published_at DESC
  const candidates = await db
    .selectFrom("videos")
    .select(["id", "youtube_video_id", "title"])
    .where("church_id", "=", churchId)
    .where("youtube_video_id", "in", allYoutubeIds.length > 0 ? allYoutubeIds : ["__none__"])
    .orderBy("published_at", "desc")
    .execute()

  // Preload maps for related computation (refreshed after each video)
  let allVideoTopics = await loadVideoTopics(db, churchId)
  let allVideoRefs = await loadVideoRefs(db, churchId)

  let tokensIngested = 0
  let videosIngested = 0
  let capHit = false

  for (const video of candidates) {
    log(`processing ${video.youtube_video_id}`)

    // Stage 2: transcripts
    const transcriptResult = await ingestVideoTranscript({
      db,
      client,
      youtubeVideoId: video.youtube_video_id,
      churchId,
    })

    if (transcriptResult.status === "no_captions") {
      log(`skip ${video.youtube_video_id}: no captions`)
      continue
    }

    // Count tokens
    const transcript = await db
      .selectFrom("transcripts")
      .select(["full_text"])
      .where("id", "=", transcriptResult.transcriptId)
      .executeTakeFirstOrThrow()
    const videoTokens = countTranscriptTokens(transcript.full_text)
    tokensIngested += videoTokens

    await db
      .updateTable("ingestion_requests")
      .set({ tokens_ingested: tokensIngested, updated_at: sql`now()` })
      .where("id", "=", request.id)
      .execute()

    // Stage 3: embeddings
    await embedVideo({ db, embedder, churchId, videoDbId: video.id })

    // Stage 4: enrichment
    await enrichVideo({ db, enricher, churchId, videoDbId: video.id, title: video.title })

    // Refresh topic/ref maps so this video's data is available for related computation
    allVideoTopics = await loadVideoTopics(db, churchId)
    allVideoRefs = await loadVideoRefs(db, churchId)

    // Stage 5: related
    await computeRelatedForVideo({ db, churchId, videoDbId: video.id, allVideoTopics, allVideoRefs })

    videosIngested += 1
    await db
      .updateTable("ingestion_requests")
      .set({ videos_ingested: videosIngested, updated_at: sql`now()` })
      .where("id", "=", request.id)
      .execute()

    log(`done ${video.youtube_video_id} (tokens: ${videoTokens}, total: ${tokensIngested})`)

    if (cap !== Number.POSITIVE_INFINITY && tokensIngested >= cap) {
      capHit = true
      log(`token cap reached (${tokensIngested} >= ${cap}); stopping`)
      break
    }
  }

  return { capHit }
}

async function ensureChurch(
  db: Kysely<Database>,
  request: IngestionRequest,
  youtubeChannelId: string,
  channelTitle: string,
): Promise<string> {
  // Check if request already has a church linked
  if (request.church_id) {
    const existing = await db
      .selectFrom("churches")
      .select(["id", "status"])
      .where("id", "=", request.church_id)
      .executeTakeFirst()
    if (existing) {
      if (existing.status === "denied" || existing.status === "suspended") {
        throw new Error(`Church ${request.church_id} has status '${existing.status}'; cannot run ingestion`)
      }
      return existing.id
    }
  }

  // Look up by youtube_channel_id in case a previous run created it
  const byChannel = await db
    .selectFrom("churches")
    .select(["id", "status"])
    .where("youtube_channel_id", "=", youtubeChannelId)
    .executeTakeFirst()

  if (byChannel) {
    if (byChannel.status === "denied" || byChannel.status === "suspended") {
      throw new Error(`Church for channel ${youtubeChannelId} has status '${byChannel.status}'`)
    }
    // Link to this request
    await db
      .updateTable("ingestion_requests")
      .set({ church_id: byChannel.id, updated_at: sql`now()` })
      .where("id", "=", request.id)
      .execute()
    return byChannel.id
  }

  // Create a new pending church
  const churchRow = await db
    .insertInto("churches")
    .values({
      slug: request.requested_slug,
      name: request.requested_name,
      youtube_channel_id: youtubeChannelId,
      status: "pending",
    })
    .returning(["id"])
    .executeTakeFirstOrThrow()

  await db
    .updateTable("ingestion_requests")
    .set({ church_id: churchRow.id, updated_at: sql`now()` })
    .where("id", "=", request.id)
    .execute()

  return churchRow.id
}

function filterPlaylists<T extends { id: string }>(
  playlists: T[],
  include: string[],
  exclude: string[],
): T[] {
  if (include.length > 0) {
    const includeSet = new Set(include)
    return playlists.filter((pl) => includeSet.has(pl.id))
  }
  if (exclude.length > 0) {
    const excludeSet = new Set(exclude)
    return playlists.filter((pl) => !excludeSet.has(pl.id))
  }
  return playlists
}
