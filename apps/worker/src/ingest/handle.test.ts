import { describe, expect, it } from "vitest"
import { normalizeHandleInput } from "./handle.js"

describe("normalizeHandleInput", () => {
  it("passes through bare @handle", () => {
    expect(normalizeHandleInput("@newhorizonchurchchampaigni2851")).toBe(
      "@newhorizonchurchchampaigni2851",
    )
  })

  it("passes through bare username without @", () => {
    expect(normalizeHandleInput("newhorizonchurchchampaigni2851")).toBe(
      "newhorizonchurchchampaigni2851",
    )
  })

  it("passes through channel id", () => {
    expect(normalizeHandleInput("UCabcdefghijklmnopqrstuv")).toBe("UCabcdefghijklmnopqrstuv")
  })

  it("extracts @handle from full youtube.com URL", () => {
    expect(normalizeHandleInput("https://www.youtube.com/@newhorizonchurchchampaigni2851")).toBe(
      "@newhorizonchurchchampaigni2851",
    )
  })

  it("extracts @handle without www", () => {
    expect(normalizeHandleInput("https://youtube.com/@StMaryVictories")).toBe("@StMaryVictories")
  })

  it("extracts @handle from m.youtube.com", () => {
    expect(normalizeHandleInput("https://m.youtube.com/@StMaryVictories")).toBe("@StMaryVictories")
  })

  it("extracts @handle when URL has trailing path", () => {
    expect(normalizeHandleInput("https://www.youtube.com/@StMaryVictories/videos")).toBe(
      "@StMaryVictories",
    )
  })

  it("extracts channel id from /channel/ URL", () => {
    expect(normalizeHandleInput("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv")).toBe(
      "UCabcdefghijklmnopqrstuv",
    )
  })

  it("extracts custom name from /c/ URL", () => {
    expect(normalizeHandleInput("https://www.youtube.com/c/MyChurch")).toBe("MyChurch")
  })

  it("extracts legacy username from /user/ URL", () => {
    expect(normalizeHandleInput("https://www.youtube.com/user/LegacyName")).toBe("LegacyName")
  })

  it("trims surrounding whitespace", () => {
    expect(normalizeHandleInput("  https://www.youtube.com/@foo  ")).toBe("@foo")
  })

  it("falls back to trimmed input for unknown URL shape", () => {
    expect(normalizeHandleInput("https://www.youtube.com/watch?v=abc")).toBe(
      "https://www.youtube.com/watch?v=abc",
    )
  })

  it("falls back for non-YouTube URLs", () => {
    expect(normalizeHandleInput("https://example.com/@foo")).toBe("https://example.com/@foo")
  })

  it("falls back for malformed URLs", () => {
    expect(normalizeHandleInput("https://")).toBe("https://")
  })
})
