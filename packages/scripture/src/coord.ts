import { BOOKS_BY_ID } from "./books.js"

export interface Ref {
  book_id: number
  chapter_start: number
  verse_start: number
  chapter_end: number
  verse_end: number
  start_coord: number
  end_coord: number
}

export function coord(book_id: number, chapter: number, verse: number): number {
  return book_id * 1_000_000 + chapter * 1_000 + verse
}

export function lastVerse(book_id: number, chapter: number): number {
  const book = BOOKS_BY_ID[book_id]
  if (!book) throw new Error(`Unknown book_id: ${book_id}`)
  const v = book.max_verse[chapter - 1]
  if (v === undefined) throw new Error(`Unknown chapter ${chapter} in book_id ${book_id}`)
  return v
}

export function display(ref: Ref): string {
  const book = BOOKS_BY_ID[ref.book_id]
  if (!book) throw new Error(`Unknown book_id: ${ref.book_id}`)
  const name = book.canonical_name

  if (ref.chapter_start === ref.chapter_end) {
    const chapterLast = lastVerse(ref.book_id, ref.chapter_start)
    if (ref.verse_start === 1 && ref.verse_end === chapterLast) {
      return `${name} ${ref.chapter_start}`
    }
    if (ref.verse_start === ref.verse_end) {
      return `${name} ${ref.chapter_start}:${ref.verse_start}`
    }
    return `${name} ${ref.chapter_start}:${ref.verse_start}-${ref.verse_end}`
  }

  return `${name} ${ref.chapter_start}:${ref.verse_start}-${ref.chapter_end}:${ref.verse_end}`
}
