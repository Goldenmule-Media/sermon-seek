/**
 * Unit tests for the serve loop's concurrency accounting.
 *
 * The loop tracks in-flight runs in a Set and refuses to claim while it is
 * full. If a finished run is never removed, the worker claims exactly one
 * request and then defers forever — it stays alive, keeps logging, and quietly
 * stops picking up work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const claimNextRequest = vi.fn()
const runClaimedRequest = vi.fn()
const reapStaleRequests = vi.fn().mockResolvedValue(undefined)

vi.mock("./requests/claim.js", () => ({
  claimNextRequest: (...a: unknown[]) => claimNextRequest(...a),
}))
vi.mock("./requests/runner.js", () => ({
  runClaimedRequest: (...a: unknown[]) => runClaimedRequest(...a),
}))
vi.mock("./requests/reaper.js", () => ({
  reapStaleRequests: (...a: unknown[]) => reapStaleRequests(...a),
}))
vi.mock("@sermon-search/db", () => ({ createDb: () => ({ destroy: async () => {} }) }))
vi.mock("@sermon-search/embeddings", () => ({ createOpenAIEmbedder: () => ({}) }))
vi.mock("@sermon-search/notifications", () => ({
  createEmailSender: () => ({ send: async () => {} }),
  loadConfigFromEnv: () => ({ from: "test@example.com" }),
}))
vi.mock("./enrich/llm.js", () => ({ createOpenAIEnricher: () => ({}) }))
vi.mock("./youtube/client.js", () => ({ YoutubeClient: class {} }))
vi.mock("./lib/heartbeat.js", () => ({
  getWorkerId: () => "test-worker",
  heartbeat: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("./lib/logger.js", () => ({
  createWorkerLogger: () => ({ info: () => {}, error: () => {}, flush: async () => {} }),
}))

const OPTS = {
  youtubeApiKey: "yt",
  openaiApiKey: "sk",
  model: "gpt-test",
  webBaseUrl: "http://localhost:3000",
  tokenCap: undefined,
  pollIntervalMs: 1,
  concurrency: 1,
  staleMs: 60_000,
  maxRetries: 3,
  dbPoolMax: 2,
}

function makeRequest(id: string) {
  return { request: { id }, priorStatus: "received" as const }
}

describe("runServeLoop concurrency accounting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reapStaleRequests.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("frees the slot when a run finishes, so the next request is claimed", async () => {
    const { runServeLoop } = await import("./serve.js")

    claimNextRequest
      .mockResolvedValueOnce(makeRequest("req-1"))
      .mockResolvedValueOnce(makeRequest("req-2"))
      .mockResolvedValue(null)

    runClaimedRequest.mockImplementation(
      async () => new Promise((resolve) => setTimeout(() => resolve({ status: "complete" }), 5)),
    )

    const timer = setTimeout(() => process.emit("SIGTERM"), 200)
    await runServeLoop(OPTS)
    clearTimeout(timer)

    // Without the slot being freed the loop claims req-1 and then reports
    // "concurrency cap reached" forever, so req-2 is never picked up.
    expect(runClaimedRequest).toHaveBeenCalledTimes(2)
    const ids = runClaimedRequest.mock.calls.map(
      (c) => (c[0] as { request: { id: string } }).request.id,
    )
    expect(ids).toEqual(["req-1", "req-2"])
  })

  it("frees the slot when a run rejects", async () => {
    const { runServeLoop } = await import("./serve.js")

    claimNextRequest
      .mockResolvedValueOnce(makeRequest("req-fail"))
      .mockResolvedValueOnce(makeRequest("req-after"))
      .mockResolvedValue(null)

    runClaimedRequest
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ status: "complete" })

    const timer = setTimeout(() => process.emit("SIGTERM"), 200)
    await runServeLoop(OPTS)
    clearTimeout(timer)

    // A failed run must not strand the slot either — one bad video would
    // otherwise take the worker out until it was restarted.
    expect(runClaimedRequest).toHaveBeenCalledTimes(2)
  })
})
