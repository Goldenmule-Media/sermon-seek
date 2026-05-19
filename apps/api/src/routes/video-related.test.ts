import { describe, expect, it } from "vitest"
import { SIGNAL_PRIORITY, buildReason } from "./video-related.js"

describe("buildReason", () => {
  it("builds same_series reason with playlist title", () => {
    const reason = buildReason("same_series", {
      playlist_id: "pl-1",
      playlist_title: "Romans Series",
    })
    expect(reason).toEqual({
      kind: "same_series",
      text: "Same series: Romans Series",
      playlist_id: "pl-1",
    })
  })

  it("builds chunk_similarity reason with quoted snippet", () => {
    const reason = buildReason("chunk_similarity", {
      matched_chunk_start_ms: 12000,
      quoted_text: "For God so loved the world.",
      source_chunk_start_ms: 5000,
    })
    expect(reason).toEqual({
      kind: "chunk_similarity",
      text: 'Similar passage: "For God so loved the world."',
      matched_chunk_start_ms: 12000,
    })
  })

  it("builds topic_overlap reason listing shared topics", () => {
    const reason = buildReason("topic_overlap", { topics: ["grace", "justification"] })
    expect(reason).toEqual({
      kind: "topic_overlap",
      text: "Also about: grace, justification",
      topics: ["grace", "justification"],
    })
  })

  it("builds scripture_overlap reason listing shared references", () => {
    const reason = buildReason("scripture_overlap", { references: ["Rom 8:1-11", "John 3:16"] })
    expect(reason).toEqual({
      kind: "scripture_overlap",
      text: "Also references: Rom 8:1-11, John 3:16",
      references: ["Rom 8:1-11", "John 3:16"],
    })
  })

  it("returns null for an unknown signal", () => {
    expect(buildReason("unknown_signal", {})).toBeNull()
  })

  it("handles empty topics array gracefully", () => {
    const reason = buildReason("topic_overlap", { topics: [] })
    expect(reason?.kind).toBe("topic_overlap")
    expect(reason?.text).toBe("Also about: ")
  })
})

describe("SIGNAL_PRIORITY", () => {
  it("same_series has highest priority (lowest number)", () => {
    // biome-ignore lint/style/noNonNullAssertion: known keys
    expect(SIGNAL_PRIORITY.same_series!).toBeLessThan(SIGNAL_PRIORITY.chunk_similarity!)
  })

  it("chunk_similarity outranks topic_overlap", () => {
    // biome-ignore lint/style/noNonNullAssertion: known keys
    expect(SIGNAL_PRIORITY.chunk_similarity!).toBeLessThan(SIGNAL_PRIORITY.topic_overlap!)
  })

  it("topic_overlap outranks scripture_overlap", () => {
    // biome-ignore lint/style/noNonNullAssertion: known keys
    expect(SIGNAL_PRIORITY.topic_overlap!).toBeLessThan(SIGNAL_PRIORITY.scripture_overlap!)
  })
})

describe("signal priority merge logic", () => {
  it("picks same_series over chunk_similarity for the same related video", () => {
    const rows = [
      { signal: "chunk_similarity", score: 0.95 },
      { signal: "same_series", score: 1.0 },
    ]
    const best = rows.reduce((a, b) => {
      const pa = SIGNAL_PRIORITY[a.signal] ?? 99
      const pb = SIGNAL_PRIORITY[b.signal] ?? 99
      if (pb < pa) return b
      if (pb === pa && b.score > a.score) return b
      return a
    })
    expect(best.signal).toBe("same_series")
  })

  it("breaks ties by score when priority is equal", () => {
    const rows = [
      { signal: "topic_overlap", score: 0.3 },
      { signal: "topic_overlap", score: 0.7 },
    ]
    const best = rows.reduce((a, b) => {
      const pa = SIGNAL_PRIORITY[a.signal] ?? 99
      const pb = SIGNAL_PRIORITY[b.signal] ?? 99
      if (pb < pa) return b
      if (pb === pa && b.score > a.score) return b
      return a
    })
    expect(best.score).toBe(0.7)
  })

  it("returns the only row when there is a single candidate", () => {
    const rows = [{ signal: "scripture_overlap", score: 0.5 }]
    const best = rows.reduce((a, b) => {
      const pa = SIGNAL_PRIORITY[a.signal] ?? 99
      const pb = SIGNAL_PRIORITY[b.signal] ?? 99
      if (pb < pa) return b
      if (pb === pa && b.score > a.score) return b
      return a
    })
    expect(best.signal).toBe("scripture_overlap")
  })
})
