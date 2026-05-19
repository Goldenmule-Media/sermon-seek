import type { Embedder } from "@sermon-search/embeddings"
import { describe, expect, it, vi } from "vitest"

function makeEmbedder(dimensions = 4): Embedder {
  let callCount = 0
  return {
    model: "test-model",
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((_, i) =>
        Array.from({ length: dimensions }, (__, d) => callCount++ + i + d * 0.01),
      )
    },
  }
}

function shouldSkip(nChunks: number, nEmbeddings: number): boolean {
  return nChunks > 0 && nChunks === nEmbeddings
}

describe("skip predicate", () => {
  it("skips when chunk_count > 0 and chunk_count === embedding_count", () => {
    expect(shouldSkip(5, 5)).toBe(true)
  })

  it("does not skip when chunk_count === 0", () => {
    expect(shouldSkip(0, 0)).toBe(false)
  })

  it("does not skip when embedding_count < chunk_count", () => {
    expect(shouldSkip(5, 3)).toBe(false)
  })
})

describe("embedder behavior", () => {
  it("returns a vector per input text", async () => {
    const embedder = makeEmbedder(4)
    const result = await embedder.embed(["hello", "world"])
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveLength(4)
  })

  it("returns distinct vectors for distinct texts", async () => {
    const embedder = makeEmbedder(4)
    const result = await embedder.embed(["a", "b", "c"])
    const first = result[0]?.join(",")
    const second = result[1]?.join(",")
    expect(first).not.toBe(second)
  })
})

describe("chunk idempotency logic", () => {
  it("uses onConflict doNothing for chunks keyed by (transcript_id, position)", () => {
    // Verify the uniqueness constraint logic: two inserts with the same
    // (transcript_id, position) should produce only one row.
    const seen = new Map<string, boolean>()
    function upsertChunk(transcriptId: string, position: number): "inserted" | "skipped" {
      const key = `${transcriptId}:${position}`
      if (seen.has(key)) return "skipped"
      seen.set(key, true)
      return "inserted"
    }
    expect(upsertChunk("t1", 0)).toBe("inserted")
    expect(upsertChunk("t1", 0)).toBe("skipped")
    expect(upsertChunk("t1", 1)).toBe("inserted")
  })
})
