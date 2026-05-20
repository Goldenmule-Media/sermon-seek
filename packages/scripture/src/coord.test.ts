import { describe, expect, it } from "vitest"
import { coord, display, lastVerse } from "./coord.js"
import type { Ref } from "./coord.js"

describe("coord", () => {
  it("applies the formula book_id * 1_000_000 + chapter * 1_000 + verse", () => {
    expect(coord(1, 1, 1)).toBe(1_001_001)
    expect(coord(45, 8, 28)).toBe(45_008_028)
    expect(coord(66, 22, 21)).toBe(66_022_021)
  })

  it("verse 0 produces a lower coord than verse 1", () => {
    expect(coord(1, 1, 0)).toBeLessThan(coord(1, 1, 1))
  })
})

describe("lastVerse", () => {
  it("returns correct verse count for Romans 8", () => {
    expect(lastVerse(45, 8)).toBe(39)
  })

  it("returns correct verse count for Psalm 119", () => {
    expect(lastVerse(19, 119)).toBe(176)
  })

  it("returns correct verse count for John 3", () => {
    expect(lastVerse(43, 3)).toBe(36)
  })

  it("returns correct verse count for Genesis 1", () => {
    expect(lastVerse(1, 1)).toBe(31)
  })

  it("throws for unknown book", () => {
    expect(() => lastVerse(99, 1)).toThrow()
  })

  it("throws for unknown chapter", () => {
    expect(() => lastVerse(45, 99)).toThrow()
  })
})

describe("display", () => {
  const make = (
    book_id: number,
    chapter_start: number,
    verse_start: number,
    chapter_end: number,
    verse_end: number,
  ): Ref => ({
    book_id,
    chapter_start,
    verse_start,
    chapter_end,
    verse_end,
    start_coord: coord(book_id, chapter_start, verse_start),
    end_coord: coord(book_id, chapter_end, verse_end),
  })

  it("whole chapter (verse_start=1 and verse_end=lastVerse)", () => {
    // Romans 8 has 39 verses
    expect(display(make(45, 8, 1, 8, 39))).toBe("Romans 8")
  })

  it("single verse", () => {
    expect(display(make(45, 8, 28, 8, 28))).toBe("Romans 8:28")
    expect(display(make(43, 3, 16, 3, 16))).toBe("John 3:16")
  })

  it("same-chapter range", () => {
    expect(display(make(45, 8, 1, 8, 5))).toBe("Romans 8:1-5")
  })

  it("cross-chapter range", () => {
    expect(display(make(45, 8, 28, 9, 5))).toBe("Romans 8:28-9:5")
  })

  it("throws for unknown book", () => {
    expect(() => display(make(99, 1, 1, 1, 1))).toThrow()
  })
})
