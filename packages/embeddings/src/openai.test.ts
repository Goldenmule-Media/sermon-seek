import { beforeEach, describe, expect, it, vi } from "vitest"
import { createOpenAIEmbedder } from "./openai.js"

const mockCreate = vi.fn()

vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: { create: mockCreate },
    })),
  }
})

function makeResponse(inputs: string[], offset = 0) {
  return {
    data: inputs.map((_, i) => ({
      index: i + offset,
      embedding: new Array(1536).fill(i + offset + 0.1),
    })),
  }
}

describe("createOpenAIEmbedder", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns vectors in input order", async () => {
    const texts = ["hello", "world"]
    mockCreate.mockResolvedValueOnce(makeResponse(texts))
    const embedder = createOpenAIEmbedder({ apiKey: "test", batchSize: 10 })
    const result = await embedder.embed(texts)
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveLength(1536)
    expect(result[0]?.[0]).toBeCloseTo(0.1)
    expect(result[1]?.[0]).toBeCloseTo(1.1)
  })

  it("splits into batches of batchSize", async () => {
    const texts = Array.from({ length: 5 }, (_, i) => `text-${i}`)
    // batchSize=2: batches [0,1], [2,3], [4]
    mockCreate
      .mockResolvedValueOnce(makeResponse(texts.slice(0, 2), 0))
      .mockResolvedValueOnce(makeResponse(texts.slice(2, 4), 2))
      .mockResolvedValueOnce(makeResponse(texts.slice(4), 4))
    const embedder = createOpenAIEmbedder({ apiKey: "test", batchSize: 2 })
    const result = await embedder.embed(texts)
    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(result).toHaveLength(5)
    // Each vector is at the right position
    for (let i = 0; i < 5; i++) {
      expect(result[i]?.[0]).toBeCloseTo(i + 0.1)
    }
  })

  it("retries on 429 and succeeds", async () => {
    vi.useFakeTimers()
    const texts = ["retry-me"]
    const err = Object.assign(new Error("rate limit"), { status: 429 })
    mockCreate.mockRejectedValueOnce(err).mockResolvedValueOnce(makeResponse(texts))
    const embedder = createOpenAIEmbedder({ apiKey: "test", batchSize: 10, maxRetries: 3 })
    const promise = embedder.embed(texts)
    await vi.runAllTimersAsync()
    const result = await promise
    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(1)
    vi.useRealTimers()
  })

  it("throws after maxRetries on persistent 429", async () => {
    const err = Object.assign(new Error("rate limit"), { status: 429 })
    mockCreate.mockRejectedValue(err)
    // maxRetries: 1 → first failure sets attempt=1 >= 1, throws immediately (no backoff delay)
    const embedder = createOpenAIEmbedder({ apiKey: "test", batchSize: 10, maxRetries: 1 })
    await expect(embedder.embed(["x"])).rejects.toThrow("rate limit")
    mockCreate.mockReset()
  })

  it("throws immediately on non-retryable error", async () => {
    const err = Object.assign(new Error("bad request"), { status: 400 })
    mockCreate.mockRejectedValueOnce(err)
    const embedder = createOpenAIEmbedder({ apiKey: "test", batchSize: 10 })
    await expect(embedder.embed(["x"])).rejects.toThrow("bad request")
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})
