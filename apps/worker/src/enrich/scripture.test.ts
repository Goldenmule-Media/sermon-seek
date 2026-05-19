import { describe, expect, it } from "vitest"
import { filterScriptureRefs } from "./scripture.js"

describe("filterScriptureRefs", () => {
  it("accepts John 3:16", () => {
    expect(filterScriptureRefs(["John 3:16"])).toEqual(["John 3:16"])
  })

  it("accepts Rom 8:28-30", () => {
    expect(filterScriptureRefs(["Rom 8:28-30"])).toEqual(["Rom 8:28-30"])
  })

  it("accepts 1 Cor 13 (chapter only)", () => {
    expect(filterScriptureRefs(["1 Cor 13"])).toEqual(["1 Cor 13"])
  })

  it("accepts 2 John 1:7", () => {
    expect(filterScriptureRefs(["2 John 1:7"])).toEqual(["2 John 1:7"])
  })

  it("rejects bare book name", () => {
    expect(filterScriptureRefs(["John"])).toEqual([])
  })

  it("rejects lowercase first letter", () => {
    expect(filterScriptureRefs(["john 3:16"])).toEqual([])
  })

  it("rejects trailing dash", () => {
    expect(filterScriptureRefs(["John 3:16-"])).toEqual([])
  })

  it("rejects junk line", () => {
    expect(filterScriptureRefs(["not a reference at all"])).toEqual([])
  })

  it("caps result at 3", () => {
    const input = ["John 3:16", "Rom 8:28", "Gen 1:1", "Ps 23:1"]
    expect(filterScriptureRefs(input)).toHaveLength(3)
  })

  it("deduplicates identical refs", () => {
    expect(filterScriptureRefs(["John 3:16", "John 3:16", "Rom 8:28"])).toEqual([
      "John 3:16",
      "Rom 8:28",
    ])
  })

  it("trims whitespace before matching", () => {
    expect(filterScriptureRefs(["  John 3:16  "])).toEqual(["John 3:16"])
  })
})
