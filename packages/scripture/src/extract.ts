import { BOOKS_BY_ID, BOOK_LOOKUP } from "./books.js"
import { coord, lastVerse } from "./coord.js"
import type { Ref } from "./coord.js"

export interface ExtractedRef extends Ref {
  occurrences: number
  positions: number[]
  first_position: number
  raw_first: string
}

// Sorted longest-first so "1 corinthians" beats "corinthians".
const bookKeys = [...BOOK_LOOKUP.keys()].sort((a, b) => b.length - a.length)

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const bookAlt = bookKeys.map(escapeRe).join("|")

// Capture groups:
//  1: book name
//  2: chapter after "chapter " keyword
//  3: chapter bare
//  4: verse after "verse " keyword
//  5: verse after ":"
//  6: verse after space (space-separator form)
//  7: end-chapter prefix ("9:" in cross-chapter range)
//  8: end verse
//  9: extra verse list (", 18, 21" etc.)
const FULL_RE = new RegExp(
  `(${bookAlt})(?:\\s+chapter\\s+(\\d+)|\\s+(\\d+))(?![.,]\\d)(?:(?:\\s+verse\\s+(\\d+)|:(\\d+)|\\s+(\\d+))(?:(?:\\s+(?:to|through)\\s+|\\s*[-–]\\s*)(\\d+:)?(\\d+))?((?:\\s*,\\s*\\d+)+)?)?`,
  "gi",
)

function isValidRef(bookId: number, cs: number, vs: number, ce: number, ve: number): boolean {
  const book = BOOKS_BY_ID[bookId]
  if (!book) return false
  if (cs < 1 || cs > book.chapter_count) return false
  if (ce < 1 || ce > book.chapter_count) return false
  const maxVs = book.max_verse[cs - 1]
  const maxVe = book.max_verse[ce - 1]
  if (maxVs === undefined || maxVe === undefined) return false
  if (vs < 1 || vs > maxVs) return false
  if (ve < 1 || ve > maxVe) return false
  return coord(bookId, cs, vs) <= coord(bookId, ce, ve)
}

export function extract(text: string): ExtractedRef[] {
  const dedup = new Map<string, ExtractedRef>()
  FULL_RE.lastIndex = 0

  let m: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: standard global-regex loop pattern
  while ((m = FULL_RE.exec(text)) !== null) {
    const position = m.index
    const fullMatch = m[0] ?? ""
    const bookRaw = m[1] ?? ""
    const chKw = m[2]
    const chBare = m[3]
    const vKw = m[4]
    const vColon = m[5]
    const vSpace = m[6]
    const ch2Raw = m[7]
    const vEndRaw = m[8]
    const extraRaw = m[9]

    const bookKey = bookRaw.toLowerCase().replace(/\s+/g, " ").trim()
    const bookId = BOOK_LOOKUP.get(bookKey)
    if (bookId === undefined) continue

    const chapterStart = Number.parseInt(chKw ?? chBare ?? "0", 10)
    if (chapterStart === 0) continue

    const verseStartStr = vKw ?? vColon ?? vSpace
    const verseStart = verseStartStr !== undefined ? Number.parseInt(verseStartStr, 10) : undefined

    const pendingRefs: Array<{
      cs: number
      vs: number
      ce: number
      ve: number
      raw: string
      pos: number
    }> = []

    if (verseStart === undefined) {
      // Chapter-only: span the whole chapter.
      const book = BOOKS_BY_ID[bookId]
      if (!book) continue
      const mv = book.max_verse[chapterStart - 1]
      if (mv === undefined) continue
      pendingRefs.push({
        cs: chapterStart,
        vs: 1,
        ce: chapterStart,
        ve: mv,
        raw: fullMatch,
        pos: position,
      })
    } else {
      let chapterEnd = chapterStart
      let verseEnd = verseStart

      if (vEndRaw !== undefined) {
        if (ch2Raw !== undefined) {
          chapterEnd = Number.parseInt(ch2Raw.slice(0, -1), 10)
        }
        verseEnd = Number.parseInt(vEndRaw, 10)
      }

      const primaryRaw = extraRaw
        ? fullMatch.slice(0, fullMatch.length - extraRaw.length)
        : fullMatch
      pendingRefs.push({
        cs: chapterStart,
        vs: verseStart,
        ce: chapterEnd,
        ve: verseEnd,
        raw: primaryRaw,
        pos: position,
      })

      if (extraRaw) {
        const extraStart = position + fullMatch.length - extraRaw.length
        const subRe = /,\s*(\d+)/g
        let sm: RegExpExecArray | null
        // biome-ignore lint/suspicious/noAssignInExpressions: standard global-regex loop pattern
        while ((sm = subRe.exec(extraRaw)) !== null) {
          const numStr = sm[1]
          const matchStr = sm[0]
          if (numStr === undefined || matchStr === undefined) continue
          const ev = Number.parseInt(numStr, 10)
          if (!Number.isNaN(ev) && ev > 0) {
            const evPos = extraStart + sm.index + matchStr.length - numStr.length
            pendingRefs.push({
              cs: chapterStart,
              vs: ev,
              ce: chapterStart,
              ve: ev,
              raw: numStr,
              pos: evPos,
            })
          }
        }
      }
    }

    for (const r of pendingRefs) {
      if (!isValidRef(bookId, r.cs, r.vs, r.ce, r.ve)) {
        console.debug(`[scripture] rejected: book=${bookId} ${r.cs}:${r.vs}-${r.ce}:${r.ve}`)
        continue
      }

      const sc = coord(bookId, r.cs, r.vs)
      const ec = coord(bookId, r.ce, r.ve)
      const key = `${sc}:${ec}`
      const existing = dedup.get(key)

      if (existing) {
        existing.occurrences++
        existing.positions.push(r.pos)
      } else {
        dedup.set(key, {
          book_id: bookId,
          chapter_start: r.cs,
          verse_start: r.vs,
          chapter_end: r.ce,
          verse_end: r.ve,
          start_coord: sc,
          end_coord: ec,
          occurrences: 1,
          positions: [r.pos],
          first_position: r.pos,
          raw_first: r.raw,
        })
      }
    }
  }

  return [...dedup.values()]
}
