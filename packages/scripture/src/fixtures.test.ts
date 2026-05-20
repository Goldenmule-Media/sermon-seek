import { describe, expect, it } from "vitest"
import { coord } from "./coord.js"
import { extract } from "./extract.js"
import { FIXTURES } from "./fixtures/transcripts.js"

describe("real-transcript fixtures", () => {
  for (const fixture of FIXTURES) {
    it(`extracts from: "${fixture.snippet}"`, () => {
      const refs = extract(fixture.snippet)

      for (const exp of fixture.expected) {
        if (exp.verse_end === -1) {
          // Chapter-only: just verify book + chapter + verse_start=1
          const found = refs.find(
            (r) =>
              r.book_id === exp.book_id &&
              r.chapter_start === exp.chapter_start &&
              r.chapter_end === exp.chapter_end &&
              r.verse_start === 1,
          )
          expect(
            found,
            `expected chapter-only ref for book ${exp.book_id} ch ${exp.chapter_start}`,
          ).toBeDefined()
        } else {
          const sc = coord(exp.book_id, exp.chapter_start, exp.verse_start)
          const ec = coord(exp.book_id, exp.chapter_end, exp.verse_end)
          const found = refs.find((r) => r.start_coord === sc && r.end_coord === ec)
          expect(
            found,
            `expected ${exp.book_id} ${exp.chapter_start}:${exp.verse_start}-${exp.chapter_end}:${exp.verse_end}`,
          ).toBeDefined()
        }
      }
    })
  }
})
