import { createDb } from "@sermon-search/db"
import { createOpenAIEmbedder } from "@sermon-search/embeddings"
import { createEmailSender, loadConfigFromEnv } from "@sermon-search/notifications"
import { createOpenAIEnricher } from "./enrich/llm.js"
import { getWorkerId, heartbeat } from "./lib/heartbeat.js"
import { createWorkerLogger } from "./lib/logger.js"
import { claimNextRequest } from "./requests/claim.js"
import { reapStaleRequests } from "./requests/reaper.js"
import { runClaimedRequest } from "./requests/runner.js"
import { YoutubeClient } from "./youtube/client.js"

export interface ServeLoopOptions {
  youtubeApiKey: string
  openaiApiKey: string
  model: string
  webBaseUrl: string
  tokenCap: number | undefined
  pollIntervalMs: number
  concurrency: number
  staleMs: number
  maxRetries: number
  dbPoolMax: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runServeLoop(opts: ServeLoopOptions): Promise<void> {
  const {
    youtubeApiKey,
    openaiApiKey,
    model,
    webBaseUrl,
    tokenCap,
    pollIntervalMs,
    concurrency,
    staleMs,
    maxRetries,
    dbPoolMax,
  } = opts

  const db = createDb(undefined, { max: dbPoolMax })
  const client = new YoutubeClient({ apiKey: youtubeApiKey })
  const embedder = createOpenAIEmbedder({ apiKey: openaiApiKey })
  const enricher = createOpenAIEnricher({ apiKey: openaiApiKey, model })
  const notificationConfig = loadConfigFromEnv()
  const sender = createEmailSender(notificationConfig)
  const workerId = getWorkerId()
  const logger = createWorkerLogger(workerId)

  const inFlight = new Set<Promise<unknown>>()
  let shuttingDown = false

  function onShutdown() {
    if (shuttingDown) return
    shuttingDown = true
    logger.info("[serve] shutdown signal received; draining in-flight requests…")
  }

  process.on("SIGTERM", onShutdown)
  process.on("SIGINT", onShutdown)

  try {
    while (!shuttingDown) {
      // Reap stale running requests.
      try {
        await reapStaleRequests({
          db,
          staleMs,
          maxRetries,
          log: (msg) => logger.info(msg),
        })
      } catch (err) {
        logger.error(`[serve] reaper error: ${err instanceof Error ? err.message : String(err)}`)
      }

      // Claim and dispatch new requests while slots are available.
      let claimed = false
      while (inFlight.size < concurrency && !shuttingDown) {
        const slot = inFlight.size
        const slotWorkerId = concurrency > 1 ? `${workerId}#${slot}` : workerId

        let claimResult: Awaited<ReturnType<typeof claimNextRequest>>
        try {
          claimResult = await claimNextRequest(db)
        } catch (err) {
          logger.error(`[serve] claim error: ${err instanceof Error ? err.message : String(err)}`)
          break
        }

        if (!claimResult) break

        claimed = true
        const { request, priorStatus } = claimResult
        logger.info(`[serve] claimed request ${request.id} (prior status: ${priorStatus})`)

        const run = runClaimedRequest({
          db,
          client,
          embedder,
          enricher,
          sender,
          notificationConfig,
          webBaseUrl,
          request,
          capped: priorStatus === "received",
          tokenCap,
          workerId: slotWorkerId,
          log: (msg) => logger.info(msg),
        }).then(
          (result) => {
            logger.info(`[serve] request ${request.id} finished: ${result.status}`)
          },
          (err: unknown) => {
            logger.error(
              `[serve] request ${request.id} failed: ${err instanceof Error ? err.message : String(err)}`,
            )
          },
        )

        inFlight.add(run)
        // Free the slot when the run settles. Doing this from the promise's own
        // continuation is the only reliable way: a Promise.race against an
        // already-resolved sentinel cannot detect settledness, because p.then()
        // always resolves a microtask later than the sentinel and so always
        // loses. `run` has both handlers attached above, so it never rejects.
        void run.finally(() => {
          inFlight.delete(run)
        })
      }

      if (inFlight.size >= concurrency && !shuttingDown) {
        logger.info(
          `[serve] concurrency cap reached (${inFlight.size}/${concurrency}); deferring further claims`,
        )
      }

      if (!claimed || inFlight.size >= concurrency) {
        // Only advertise idle when nothing is actually running. With concurrency=1
        // the per-job beats share this worker's single heartbeat row, so emitting
        // an idle beat (last_job_id=null) while a job is in flight would blank the
        // running request's owning beat and make the reaper falsely reap it.
        if (inFlight.size === 0) {
          void heartbeat(db, { workerId, kind: "ingest", status: "idle", message: "idle" })
        }
        await sleep(pollIntervalMs)
      }
    }
  } finally {
    // Drain remaining in-flight requests before exiting.
    if (inFlight.size > 0) {
      logger.info(`[serve] waiting for ${inFlight.size} in-flight request(s) to complete…`)
      await Promise.allSettled(inFlight)
    }
    await logger.flush()
    process.off("SIGTERM", onShutdown)
    process.off("SIGINT", onShutdown)
    await db.destroy()
    logger.info("[serve] shutdown complete")
  }
}
