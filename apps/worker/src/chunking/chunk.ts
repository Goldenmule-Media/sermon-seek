import type { TranscriptSegmentRow } from "@sermon-search/db"

export interface ChunkOptions {
  minMs?: number
  targetMs?: number
  maxMs?: number
}

export interface Chunk {
  start_ms: number
  end_ms: number
  text: string
  segment_ids: string[]
}

export function chunkSegments(segments: TranscriptSegmentRow[], opts: ChunkOptions = {}): Chunk[] {
  const { minMs = 30_000, targetMs = 45_000, maxMs = 60_000 } = opts

  if (segments.length === 0) return []

  const sorted = [...segments].sort((a, b) => a.start_ms - b.start_ms)
  const chunks: Chunk[] = []

  // Each chunk after the first re-includes the previous chunk's last segment
  // as its own first segment. This guarantees any phrase that straddles a
  // chunk boundary appears whole inside at least one chunk — Postgres FTS
  // requires all query lexemes to live in the same tsvector to match.
  let buffer: TranscriptSegmentRow[] = []
  let bufferDuration = 0
  let prevTailSeg: TranscriptSegmentRow | null = null

  function seedFromPrev(): void {
    if (prevTailSeg === null) return
    buffer.push(prevTailSeg)
    bufferDuration += prevTailSeg.end_ms - prevTailSeg.start_ms
  }

  function flush(): void {
    if (buffer.length === 0) return
    const first = buffer[0] as TranscriptSegmentRow
    const last = buffer[buffer.length - 1] as TranscriptSegmentRow
    chunks.push({
      start_ms: first.start_ms,
      end_ms: last.end_ms,
      text: buffer.map((s) => s.text).join(" "),
      segment_ids: buffer.map((s) => s.id),
    })
    prevTailSeg = last
    buffer = []
    bufferDuration = 0
  }

  for (const seg of sorted) {
    const segDuration = seg.end_ms - seg.start_ms

    if (buffer.length === 0) {
      seedFromPrev()
      buffer.push(seg)
      bufferDuration += segDuration
      continue
    }

    const newDuration = bufferDuration + segDuration

    if (newDuration > maxMs && bufferDuration >= minMs) {
      flush()
      seedFromPrev()
      buffer.push(seg)
      bufferDuration += segDuration
      continue
    }

    buffer.push(seg)
    bufferDuration = newDuration

    if (bufferDuration >= targetMs) {
      flush()
    }
  }

  flush()

  return chunks
}
