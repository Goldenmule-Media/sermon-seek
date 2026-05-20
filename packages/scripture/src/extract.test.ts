import { describe, expect, it } from "vitest"
import { coord } from "./coord.js"
import { extract } from "./extract.js"

// Helper: find the first extracted ref matching book_id + coords.
function findRef(text: string, bookId: number, cs: number, vs: number, ce: number, ve: number) {
  const refs = extract(text)
  const sc = coord(bookId, cs, vs)
  const ec = coord(bookId, ce, ve)
  return refs.find((r) => r.start_coord === sc && r.end_coord === ec)
}

describe("chapter-only forms", () => {
  it("Romans 8 (canonical name)", () => {
    const r = findRef("Romans 8", 45, 8, 1, 8, 39)
    expect(r).toBeDefined()
  })

  it("Rom 8 (abbreviation)", () => {
    const r = findRef("Rom 8", 45, 8, 1, 8, 39)
    expect(r).toBeDefined()
  })

  it("Romans chapter 8", () => {
    const r = findRef("Romans chapter 8", 45, 8, 1, 8, 39)
    expect(r).toBeDefined()
  })
})

describe("single-verse forms", () => {
  it("Romans 8 3 (space separator)", () => {
    const r = findRef("Romans 8 3", 45, 8, 3, 8, 3)
    expect(r).toBeDefined()
  })

  it("Romans 8:3 (colon separator)", () => {
    const r = findRef("Romans 8:3", 45, 8, 3, 8, 3)
    expect(r).toBeDefined()
  })

  it("Romans chapter 8 verse 3", () => {
    const r = findRef("Romans chapter 8 verse 3", 45, 8, 3, 8, 3)
    expect(r).toBeDefined()
  })
})

describe("range forms", () => {
  it("Romans 8:1-5 (hyphen)", () => {
    const r = findRef("Romans 8:1-5", 45, 8, 1, 8, 5)
    expect(r).toBeDefined()
  })

  it("Rom 8:1–5 (en-dash)", () => {
    const r = findRef("Rom 8:1–5", 45, 8, 1, 8, 5)
    expect(r).toBeDefined()
  })

  it("Romans 8 1 through 14 (through keyword)", () => {
    const r = findRef("Romans 8 1 through 14", 45, 8, 1, 8, 14)
    expect(r).toBeDefined()
  })

  it("Romans 8:1 to 5 (to keyword)", () => {
    const r = findRef("Romans 8:1 to 5", 45, 8, 1, 8, 5)
    expect(r).toBeDefined()
  })
})

describe("cross-chapter range", () => {
  it("Romans 8:28-9:5", () => {
    const r = findRef("Romans 8:28-9:5", 45, 8, 28, 9, 5)
    expect(r).toBeDefined()
  })

  it("rejects Romans 8:28-9:99 (invalid end verse)", () => {
    const refs = extract("Romans 8:28-9:99")
    // Romans 9 has 21 verses, so 99 is invalid.
    expect(refs).toHaveLength(0)
  })
})

describe("verse list expansion", () => {
  it("John 3:16, 18 → two intervals", () => {
    const refs = extract("John 3:16, 18")
    const r16 = refs.find((r) => r.start_coord === coord(43, 3, 16))
    const r18 = refs.find((r) => r.start_coord === coord(43, 3, 18))
    expect(r16).toBeDefined()
    expect(r18).toBeDefined()
    expect(r16?.raw_first).toBe("John 3:16")
    expect(r16?.first_position).toBe(0)
    expect(r18?.raw_first).toBe("18")
    expect(r18?.first_position).toBe("John 3:16, ".length)
  })
})

describe("ordinal book forms", () => {
  it("1 Corinthians 13", () => {
    // 1 Cor 13 has 13 verses
    const r = findRef("1 Corinthians 13", 46, 13, 1, 13, 13)
    expect(r).toBeDefined()
  })

  it("1 Cor 13:4-7", () => {
    const r = findRef("1 Cor 13:4-7", 46, 13, 4, 13, 7)
    expect(r).toBeDefined()
  })

  it("First Corinthians 13", () => {
    const r = findRef("First Corinthians 13", 46, 13, 1, 13, 13)
    expect(r).toBeDefined()
  })

  it("first corinthians 10 13 (ASR lowercase + space)", () => {
    const r = findRef("first corinthians 10 13", 46, 10, 13, 10, 13)
    expect(r).toBeDefined()
  })

  it("third john 1 (3 John)", () => {
    // 3 John has 1 chapter with 15 verses
    const r = findRef("third john 1", 64, 1, 1, 1, 15)
    expect(r).toBeDefined()
  })
})

describe("abbreviations", () => {
  it("Jn 3:16 → John 3:16", () => {
    const r = findRef("Jn 3:16", 43, 3, 16, 3, 16)
    expect(r).toBeDefined()
  })

  it("Jas 1:2 → James 1:2", () => {
    const r = findRef("Jas 1:2", 59, 1, 2, 1, 2)
    expect(r).toBeDefined()
  })

  it("Hab 3:2 → Habakkuk 3:2", () => {
    const r = findRef("Hab 3:2", 35, 3, 2, 3, 2)
    expect(r).toBeDefined()
  })

  it("Phlm 1 → Philemon 1", () => {
    const r = findRef("Phlm 1", 57, 1, 1, 1, 25)
    expect(r).toBeDefined()
  })

  it("Phil 4:4 → Philippians 4:4", () => {
    const r = findRef("Phil 4:4", 50, 4, 4, 4, 4)
    expect(r).toBeDefined()
  })

  it("Jud 1 → Jude 1", () => {
    const r = findRef("Jud 1", 65, 1, 1, 1, 25)
    expect(r).toBeDefined()
  })
})

describe("NOT supported separators", () => {
  it("Rom 8.3 (period) returns empty", () => {
    expect(extract("Rom 8.3")).toHaveLength(0)
  })

  it("Rom 8,3 (comma) returns empty", () => {
    expect(extract("Rom 8,3")).toHaveLength(0)
  })
})

describe("validation — out-of-range rejection", () => {
  it("Romans 8:99 rejected (verse > max)", () => {
    expect(extract("Romans 8:99")).toHaveLength(0)
  })

  it("Romans 8:5-1 rejected (backwards range)", () => {
    expect(extract("Romans 8:5-1")).toHaveLength(0)
  })

  it("Romans 8:28-9:99 rejected (cross-chapter invalid end)", () => {
    expect(extract("Romans 8:28-9:99")).toHaveLength(0)
  })

  it("Romans 99:1 rejected (chapter out of range)", () => {
    // Romans has 16 chapters
    expect(extract("Romans 99:1")).toHaveLength(0)
  })
})

describe("case-insensitivity", () => {
  it("all-lowercase input", () => {
    const r = findRef("romans 8:28", 45, 8, 28, 8, 28)
    expect(r).toBeDefined()
  })

  it("all-uppercase input", () => {
    const r = findRef("ROMANS 8:28", 45, 8, 28, 8, 28)
    expect(r).toBeDefined()
  })

  it("mixed case", () => {
    const r = findRef("rOmAnS 8:28", 45, 8, 28, 8, 28)
    expect(r).toBeDefined()
  })
})

describe("de-duplication and occurrence counting", () => {
  it("same ref appearing 3 times → occurrences=3, positions.length=3", () => {
    const text = "Romans 8:28 and Romans 8:28 and also Romans 8:28"
    const refs = extract(text)
    const r = refs.find((r) => r.start_coord === coord(45, 8, 28))
    expect(r).toBeDefined()
    expect(r?.occurrences).toBe(3)
    expect(r?.positions).toHaveLength(3)
    expect(r?.first_position).toBe(r?.positions[0])
    expect(r?.raw_first).toBe("Romans 8:28")
  })

  it("distinct refs produce separate entries", () => {
    const refs = extract("Romans 8 and Romans 8:3")
    // Romans 8 (whole chapter) and Romans 8:3 are different coords
    const ch = refs.find((r) => r.verse_start === 1 && r.verse_end === 39 && r.chapter_start === 8)
    const vs = refs.find((r) => r.verse_start === 3 && r.verse_end === 3)
    expect(ch).toBeDefined()
    expect(vs).toBeDefined()
  })
})
