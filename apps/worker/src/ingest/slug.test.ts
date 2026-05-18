import { describe, expect, it } from "vitest"
import { baseSlug, disambiguatedSlug, uniqueSlugForPlaylist } from "./slug.js"

describe("baseSlug", () => {
  it("lowercases and dashes", () => {
    expect(baseSlug("Sunday Sermons 2024")).toBe("sunday-sermons-2024")
  })
  it("ASCII-folds diacritics", () => {
    expect(baseSlug("Café Lectures")).toBe("cafe-lectures")
  })
  it("collapses non-alphanumerics", () => {
    expect(baseSlug("Q&A: Marriage / Family")).toBe("q-a-marriage-family")
  })
  it("trims surrounding dashes", () => {
    expect(baseSlug("  -Hello-  ")).toBe("hello")
  })
  it("falls back when title is empty", () => {
    expect(baseSlug("✨✨")).toBe("playlist")
  })
})

describe("disambiguatedSlug", () => {
  it("appends 6-char playlist id suffix", () => {
    expect(disambiguatedSlug("Sermons", "PLabcdefGHIJKL")).toBe("sermons-ghijkl")
  })
})

describe("uniqueSlugForPlaylist", () => {
  it("returns base when not taken", () => {
    const taken = new Set<string>()
    expect(uniqueSlugForPlaylist("Sermons", "PLxxxxxxABCDEF", taken)).toBe("sermons")
  })
  it("returns disambiguated when base is taken", () => {
    const taken = new Set(["sermons"])
    expect(uniqueSlugForPlaylist("Sermons", "PLxxxxxxABCDEF", taken)).toBe("sermons-abcdef")
  })
})
