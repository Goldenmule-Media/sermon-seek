import { describe, expect, it } from "vitest"
import { BOOKS, BOOKS_BY_ID, BOOK_LOOKUP } from "./books.js"

describe("BOOKS", () => {
  it("has exactly 66 books", () => {
    expect(BOOKS).toHaveLength(66)
  })

  it("has contiguous ids 1..66", () => {
    for (let i = 0; i < 66; i++) {
      expect(BOOKS[i]?.id).toBe(i + 1)
    }
  })

  it("book 1 is Genesis", () => {
    expect(BOOKS[0]?.canonical_name).toBe("Genesis")
  })

  it("book 66 is Revelation", () => {
    expect(BOOKS[65]?.canonical_name).toBe("Revelation")
  })

  it("every max_verse.length equals chapter_count", () => {
    for (const book of BOOKS) {
      expect(book.max_verse).toHaveLength(book.chapter_count)
    }
  })

  it("spot-checks known verse counts", () => {
    // Romans 8 = 39 verses
    const romans = BOOKS_BY_ID[45]
    expect(romans?.max_verse[7]).toBe(39)
    // Psalm 119 = 176 verses
    const psalms = BOOKS_BY_ID[19]
    expect(psalms?.max_verse[118]).toBe(176)
    // John 3 = 36 verses
    const john = BOOKS_BY_ID[43]
    expect(john?.max_verse[2]).toBe(36)
  })
})

describe("BOOK_LOOKUP", () => {
  it("has no collisions (construction would throw on collision)", () => {
    // The map is built at module load; if it throws, we'd never get here.
    expect(BOOK_LOOKUP.size).toBeGreaterThan(0)
  })

  it("resolves canonical names case-insensitively", () => {
    expect(BOOK_LOOKUP.get("genesis")).toBe(1)
    expect(BOOK_LOOKUP.get("revelation")).toBe(66)
    expect(BOOK_LOOKUP.get("romans")).toBe(45)
  })

  it("resolves standard abbreviations", () => {
    expect(BOOK_LOOKUP.get("rom")).toBe(45)
    expect(BOOK_LOOKUP.get("gen")).toBe(1)
    expect(BOOK_LOOKUP.get("rev")).toBe(66)
    expect(BOOK_LOOKUP.get("jn")).toBe(43)
    expect(BOOK_LOOKUP.get("jas")).toBe(59)
    expect(BOOK_LOOKUP.get("hab")).toBe(35)
    expect(BOOK_LOOKUP.get("phil")).toBe(50)
    expect(BOOK_LOOKUP.get("phlm")).toBe(57)
    expect(BOOK_LOOKUP.get("phm")).toBe(57)
    expect(BOOK_LOOKUP.get("jud")).toBe(65)
  })

  it("ordinal books include digit prefix variants", () => {
    expect(BOOK_LOOKUP.get("1 corinthians")).toBe(46)
    expect(BOOK_LOOKUP.get("2 corinthians")).toBe(47)
    expect(BOOK_LOOKUP.get("1 samuel")).toBe(9)
    expect(BOOK_LOOKUP.get("2 samuel")).toBe(10)
    expect(BOOK_LOOKUP.get("1 kings")).toBe(11)
    expect(BOOK_LOOKUP.get("2 kings")).toBe(12)
    expect(BOOK_LOOKUP.get("1 cor")).toBe(46)
    expect(BOOK_LOOKUP.get("2 cor")).toBe(47)
  })

  it("ordinal books include spoken-numeral prefix variants", () => {
    expect(BOOK_LOOKUP.get("first corinthians")).toBe(46)
    expect(BOOK_LOOKUP.get("second corinthians")).toBe(47)
    expect(BOOK_LOOKUP.get("first samuel")).toBe(9)
    expect(BOOK_LOOKUP.get("second samuel")).toBe(10)
    expect(BOOK_LOOKUP.get("first kings")).toBe(11)
    expect(BOOK_LOOKUP.get("second kings")).toBe(12)
    expect(BOOK_LOOKUP.get("first cor")).toBe(46)
    expect(BOOK_LOOKUP.get("third john")).toBe(64)
  })

  it("has no single-letter abbreviation keys", () => {
    for (const key of BOOK_LOOKUP.keys()) {
      expect(key.length).toBeGreaterThan(1)
    }
  })
})
