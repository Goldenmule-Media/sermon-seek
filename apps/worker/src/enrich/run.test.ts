import { describe, expect, it } from "vitest"
import { filterScriptureRefs } from "./scripture.js"
import { slugifyTopic } from "./topics.js"

// Unit tests for enrichment orchestration logic (no DB required)

describe("skip predicate", () => {
  it("skips when already enriched at same model_version", () => {
    const alreadyEnriched = (existingModelVersion: string | null, enricherModel: string) =>
      existingModelVersion === enricherModel

    expect(alreadyEnriched("gpt-4o-mini", "gpt-4o-mini")).toBe(true)
    expect(alreadyEnriched(null, "gpt-4o-mini")).toBe(false)
    expect(alreadyEnriched("gpt-4o", "gpt-4o-mini")).toBe(false)
  })

  it("does not skip when force is true even if already enriched", () => {
    const shouldSkip = (
      existingModelVersion: string | null,
      enricherModel: string,
      force: boolean,
    ) => !force && existingModelVersion === enricherModel

    expect(shouldSkip("gpt-4o-mini", "gpt-4o-mini", false)).toBe(true)
    expect(shouldSkip("gpt-4o-mini", "gpt-4o-mini", true)).toBe(false)
  })
})

describe("topic slug deduplication", () => {
  it("maps multiple topic labels to unique slugs", () => {
    const topics = ["Grace and Truth", "Grace and Truth", "Faith", "faith"]
    const slugs = topics.map(slugifyTopic)
    const unique = [...new Set(slugs)]
    expect(unique).toEqual(["grace-and-truth", "faith"])
  })

  it("collapses special characters", () => {
    expect(slugifyTopic("God's Love")).toBe("god-s-love")
  })

  it("strips leading and trailing dashes", () => {
    expect(slugifyTopic("--grace--")).toBe("grace")
  })
})

describe("scripture filtering in enrichment pipeline", () => {
  it("drops invalid refs returned by LLM", () => {
    const llmOutput = ["John 3:16", "not a reference", "Romans 8:28-30", "john 3:16"]
    const result = filterScriptureRefs(llmOutput)
    expect(result).toEqual(["John 3:16", "Romans 8:28-30"])
  })

  it("caps at 3 even when LLM returns more valid refs", () => {
    const llmOutput = ["John 3:16", "Rom 8:28", "Gen 1:1", "Ps 23:1"]
    expect(filterScriptureRefs(llmOutput)).toHaveLength(3)
  })

  it("deduplicates identical refs across two videos sharing the same topic", () => {
    // Simulates the same topic slug appearing for two videos
    const video1Topics = ["grace", "faith", "grace"] // dup in one call
    const video2Topics = ["faith", "hope"]

    const unique1 = [...new Set(video1Topics.map(slugifyTopic))]
    const unique2 = [...new Set(video2Topics.map(slugifyTopic))]

    expect(unique1).toEqual(["grace", "faith"])
    expect(unique2).toEqual(["faith", "hope"])

    // 'faith' slug is shared — both videos point at same topics row
    const sharedSlug = unique1.find((s) => unique2.includes(s))
    expect(sharedSlug).toBe("faith")
  })
})
