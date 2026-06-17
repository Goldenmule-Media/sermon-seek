import type { Database } from "@sermon-search/db"
import type { Embedder } from "@sermon-search/embeddings"
import type { EmailSender, NotificationConfig } from "@sermon-search/notifications"
import { notify } from "@sermon-search/notifications"
import type { IngestionRequest } from "@sermon-search/types"
import { type Kysely, sql } from "kysely"
import type { Enricher } from "../enrich/llm.js"
import { enrichVideo } from "../enrich/run.js"
import {
  findVideosMissingDuration,
  updateVideoFromMetadata,
  upsertVideoFromPlaylistItem,
} from "../ingest/channel.js"
import { embedVideo } from "../ingest/embed.js"
import { applyPlaylistFilterRules } from "../ingest/filter_rules.js"
import { resolveChannel } from "../ingest/handle.js"
import { uniqueSlugForPlaylist } from "../ingest/slug.js"
import { ingestVideoTranscript } from "../ingest/transcript.js"
import { getWorkerId, heartbeat } from "../lib/heartbeat.js"
import { computeRelatedForVideo, loadVideoRefs, loadVideoTopics } from "../related/run.js"
import {
  getChannelMetadata,
  getChannelPlaylists,
  getPlaylistItems,
  getVideosBatched,
} from "../youtube/cache_aware.js"
import type { YoutubeClient } from "../youtube/client.js"
import type { YoutubePlaylistItem } from "../youtube/types.js"
import { claimRequestById } from "./claim.js"
import {
  LIMITED_INGEST_TOKEN_CAP_DEFAULT,
  countTranscriptTokens,
} from "./limited-ingest-token-cap.js"

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
  workerId?: string
  log?: (msg: string) => void
}

export interface RunClaimedRequestOptions {
  db: Kysely<Database>
  client: YoutubeClient
  embedder: Embedder
  enricher: Enricher
  sender: EmailSender
  notificationConfig: NotificationConfig
  webBaseUrl: string
  /** Request already in status='running' (returned from a claimRequest* call). */
  request: IngestionRequest
  /** Whether a token cap applies (true when prior status was 'received'). */
  capped: boolean
  tokenCap?: number
  workerId?: string
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
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
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
  workerId = getWorkerId(),
  log = () => {},
}: RunIngestionRequestOptions): Promise<RunIngestionRequestResult> {
  const claimed = await claimRequestById(db, requestId)
  if (!claimed) {
    throw new Error(
      `Cannot run request ${requestId}: already claimed or not in a runnable state (expected 'received' or 'approved')`,
    )
  }
  return runClaimedRequest({
    db,
    client,
    embedder,
    enricher,
    sender,
    notificationConfig,
    webBaseUrl,
    request: claimed.request,
    capped: claimed.priorStatus === "received",
    tokenCap,
    workerId,
    log,
  })
}

export async function runClaimedRequest({
  db,
  client,
  embedder,
  enricher,
  sender,
  notificationConfig,
  webBaseUrl,
  request,
  capped,
  tokenCap,
  workerId = getWorkerId(),
  log = () => {},
}: RunClaimedRequestOptions): Promise<RunIngestionRequestResult> {
  const requestId = request.id
  const beat = (stage: string) =>
    heartbeat(db, {
      workerId,
      kind: "ingest",
      status: "busy",
      lastJobId: requestId,
      message: stage,
    })

  // Await the first beat so this request's owning heartbeat (last_job_id) is
  // committed before the long discovery phase — otherwise a starved fire-and-forget
  // beat can leave last_job_id blank and the reaper will falsely reap the run.
  await beat("start")
  const cap = capped ? (tokenCap ?? LIMITED_INGEST_TOKEN_CAP_DEFAULT) : Number.POSITIVE_INFINITY

  try {
    const result = await runPipeline({
      db,
      client,
      embedder,
      enricher,
      request,
      cap,
      log,
      beat,
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
      void heartbeat(db, {
        workerId,
        kind: "ingest",
        status: "idle",
        lastJobId: requestId,
        message: "awaiting_approval",
      })
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
      .set({ status: "complete", limit_reached: false, updated_at: sql`now()` })
      .where("id", "=", requestId)
      .execute()
    const completedRequest = await reloadRequest(db, requestId)
    await notify(
      sender,
      "complete",
      { request: completedRequest, webBaseUrl, searchUrl: searchUrl ?? "" },
      notificationConfig,
    )
    void heartbeat(db, {
      workerId,
      kind: "ingest",
      status: "idle",
      lastJobId: requestId,
      message: "complete",
    })
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
    void heartbeat(db, {
      workerId,
      kind: "ingest",
      status: "error",
      lastJobId: requestId,
      message: note,
    })
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
  beat,
}: {
  db: Kysely<Database>
  client: YoutubeClient
  embedder: Embedder
  enricher: Enricher
  request: IngestionRequest
  cap: number
  log: (msg: string) => void
  beat: (stage: string) => void
}): Promise<PipelineResult> {
  // Step 2: Resolve channel
  void beat("resolve_channel")
  const resolved = await resolveChannel(client, request.youtube_handle_or_url)
  log(`resolved channel ${resolved.youtubeChannelId}: ${resolved.title}`)

  // Ensure churches row exists and is linked
  const churchId = await ensureChurch(db, request, resolved.youtubeChannelId, resolved.title)

  // Upsert channels row
  void beat("upsert_channel")
  const { channel } = await getChannelMetadata(client, resolved.youtubeChannelId)
  const channelTitle = channel.snippet?.title ?? resolved.title
  const channelRow = await db
    .insertInto("channels")
    .values({
      church_id: churchId,
      youtube_channel_id: resolved.youtubeChannelId,
      title: channelTitle,
    })
    .onConflict((oc) =>
      oc.columns(["church_id", "youtube_channel_id"]).doUpdateSet({ title: channelTitle }),
    )
    .returning(["id"])
    .executeTakeFirstOrThrow()
  const channelDbId = channelRow.id
  log(`upserted channel row ${channelDbId}`)

  // Step 3: Enumerate playlists with include/exclude filtering
  void beat("enumerate_playlists")
  const { playlists: rawPlaylists } = await getChannelPlaylists(client, resolved.youtubeChannelId)
  const requestRules = [
    ...request.include_playlist_ids.map((id) => ({
      rule_type: "include" as const,
      target_kind: "playlist",
      target_id: id,
    })),
    ...request.exclude_playlist_ids.map((id) => ({
      rule_type: "exclude" as const,
      target_kind: "playlist",
      target_id: id,
    })),
  ]
  const { kept: playlists } = applyPlaylistFilterRules(rawPlaylists, requestRules)
  log(`${playlists.length}/${rawPlaylists.length} playlists after filtering`)

  // Persist playlist rows
  const existingPlaylistRows = await db
    .selectFrom("playlists")
    .select(["youtube_playlist_id", "slug"])
    .where("channel_id", "=", channelDbId)
    .execute()
  const existingSlugByPlaylistId = new Map(
    existingPlaylistRows.map((r) => [r.youtube_playlist_id, r.slug]),
  )
  const takenSlugs = new Set(existingPlaylistRows.map((r) => r.slug))
  const positionByPlaylistId = new Map(playlists.map((pl, i) => [pl.id, i]))
  const sortedPlaylists = [...playlists].sort((a, b) => a.id.localeCompare(b.id))
  const playlistDbIds = new Map<string, string>()
  let playlistsPersisted = 0
  for (const pl of sortedPlaylists) {
    const title = pl.snippet?.title ?? "(untitled playlist)"
    const position = positionByPlaylistId.get(pl.id) ?? 0
    let slug = existingSlugByPlaylistId.get(pl.id)
    if (slug === undefined) {
      slug = uniqueSlugForPlaylist(title, pl.id, takenSlugs)
      takenSlugs.add(slug)
    }
    if (++playlistsPersisted % 25 === 0) {
      void beat(`persist_playlists ${playlistsPersisted}/${sortedPlaylists.length}`)
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
  void beat("enumerate_videos")
  const videoFirstSeen = new Map<string, YoutubePlaylistItem>()
  const joinRows: Array<{ youtubeVideoId: string; youtubePlaylistId: string; position: number }> =
    []

  let playlistsScanned = 0
  for (const pl of playlists) {
    const { items } = await getPlaylistItems(client, resolved.youtubeChannelId, pl.id)
    for (const item of items) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId
      if (!videoId) continue
      joinRows.push({
        youtubeVideoId: videoId,
        youtubePlaylistId: pl.id,
        position: item.snippet?.position ?? 0,
      })
      if (!videoFirstSeen.has(videoId)) videoFirstSeen.set(videoId, item)
    }
    // Heartbeat through the per-playlist YouTube enumeration — for a large
    // channel this loop alone can exceed the reaper's stale window, which would
    // otherwise reset the in-flight request mid-discovery (retry_count churn,
    // and double-claiming if more than one worker is running).
    playlistsScanned++
    void beat(`enumerate_videos ${playlistsScanned}/${playlists.length}`)
  }

  // Upsert video + video_playlists rows
  await db.transaction().execute(async (trx) => {
    let videosUpserted = 0
    for (const [videoId, item] of videoFirstSeen) {
      await upsertVideoFromPlaylistItem(trx, channelDbId, churchId, videoId, item)
      if (++videosUpserted % 100 === 0) {
        void beat(`upsert_videos ${videosUpserted}/${videoFirstSeen.size}`)
      }
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
        .onConflict((oc) =>
          oc.columns(["video_id", "playlist_id"]).doUpdateSet({ position: row.position }),
        )
        .execute()
    }
  })

  // Backfill missing durations
  const allYoutubeIds = Array.from(videoFirstSeen.keys())
  const idsMissingDuration = await findVideosMissingDuration(db, allYoutubeIds)
  if (idsMissingDuration.length > 0) {
    void beat("backfill_durations")
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

  let tokensIngested = request.tokens_ingested
  let videosIngested = request.videos_ingested
  let videosFailed = 0
  let capHit = false

  for (const video of candidates) {
    void beat(`video:${video.youtube_video_id}`)
    log(`processing ${video.youtube_video_id}`)

    try {
      // Stage 2: transcripts
      void beat(`transcript:${video.youtube_video_id}`)
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

      let videoTokens = 0
      if (transcriptResult.status === "ok") {
        // Count tokens only for newly ingested transcripts
        const transcript = await db
          .selectFrom("transcripts")
          .select(["full_text"])
          .where("id", "=", transcriptResult.transcriptId)
          .executeTakeFirstOrThrow()
        videoTokens = countTranscriptTokens(transcript.full_text)
        tokensIngested += videoTokens

        await db
          .updateTable("ingestion_requests")
          .set({ tokens_ingested: tokensIngested, updated_at: sql`now()` })
          .where("id", "=", request.id)
          .execute()
      }

      // Stage 3: embeddings (idempotent — no-ops if already done)
      void beat(`embed:${video.youtube_video_id}`)
      await embedVideo({ db, embedder, churchId, videoDbId: video.id })

      // Stage 4: enrichment (idempotent — no-ops if already done)
      void beat(`enrich:${video.youtube_video_id}`)
      await enrichVideo({ db, enricher, churchId, videoDbId: video.id, title: video.title })

      // Refresh topic/ref maps so this video's data is available for related computation
      allVideoTopics = await loadVideoTopics(db, churchId)
      allVideoRefs = await loadVideoRefs(db, churchId)

      // Stage 5: related (idempotent — no-ops if already done)
      void beat(`related:${video.youtube_video_id}`)
      await computeRelatedForVideo({
        db,
        churchId,
        videoDbId: video.id,
        allVideoTopics,
        allVideoRefs,
      })

      if (transcriptResult.status === "ok") {
        videosIngested += 1
        await db
          .updateTable("ingestion_requests")
          .set({ videos_ingested: videosIngested, updated_at: sql`now()` })
          .where("id", "=", request.id)
          .execute()

        log(`done ${video.youtube_video_id} (tokens: ${videoTokens}, total: ${tokensIngested})`)
      } else {
        log(`skip ${video.youtube_video_id}: transcript already present (status=skipped)`)
      }
    } catch (err) {
      // A single unavailable video (deleted or made private on YouTube since the
      // last ingest, or a transient per-video fetch error) must not fail the whole
      // run. Skip it and keep going — the request still completes with what worked.
      videosFailed++
      log(`skip ${video.youtube_video_id}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    if (cap !== Number.POSITIVE_INFINITY && tokensIngested >= cap) {
      capHit = true
      log(`token cap reached (${tokensIngested} >= ${cap}); stopping`)
      break
    }
  }

  if (videosFailed > 0) {
    log(`completed with ${videosFailed} video(s) skipped due to per-video errors`)
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
        throw new Error(
          `Church ${request.church_id} has status '${existing.status}'; cannot run ingestion`,
        )
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
