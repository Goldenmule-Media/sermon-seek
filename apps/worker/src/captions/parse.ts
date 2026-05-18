import { VttParseError } from "./errors.js"

export interface Segment {
  start_ms: number
  end_ms: number
  text: string
  words: Word[]
}

export interface Word {
  start_ms: number
  end_ms: number
  text: string
  position: number
}

const TIMESTAMP_RE = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})\.(\d{3})$/
const CUE_HEADER_RE =
  /^(\d{1,3}:)?\d{1,2}:\d{1,2}\.\d{3}\s+-->\s+(\d{1,3}:)?\d{1,2}:\d{1,2}\.\d{3}(\s+.*)?$/
const INLINE_TS_RE = /<(\d{1,3}:\d{1,2}:\d{1,2}\.\d{3})>/g
const ANY_TAG_RE = /<[^>]*>/g

export function parseTimestamp(raw: string): number {
  const m = raw.match(TIMESTAMP_RE)
  if (!m) throw new VttParseError(`Invalid timestamp: ${JSON.stringify(raw)}`)
  const h = m[1] ? Number.parseInt(m[1], 10) : 0
  const min = Number.parseInt(m[2] as string, 10)
  const sec = Number.parseInt(m[3] as string, 10)
  const ms = Number.parseInt(m[4] as string, 10)
  if (min > 59 || sec > 59) {
    throw new VttParseError(`Out-of-range timestamp components: ${JSON.stringify(raw)}`)
  }
  return h * 3600000 + min * 60000 + sec * 1000 + ms
}

interface RawCue {
  start_ms: number
  end_ms: number
  body: string[]
}

function parseCueHeader(line: string): { start_ms: number; end_ms: number } {
  if (!CUE_HEADER_RE.test(line)) {
    throw new VttParseError(`Malformed cue header: ${JSON.stringify(line)}`)
  }
  const [left, rest] = line.split("-->")
  const startRaw = (left ?? "").trim()
  const endRaw = ((rest ?? "").trim().split(/\s+/)[0] ?? "").trim()
  return { start_ms: parseTimestamp(startRaw), end_ms: parseTimestamp(endRaw) }
}

function tokenizeCues(raw: string): RawCue[] {
  const normalized = raw.replace(/\r\n?/g, "\n")
  const lines = normalized.split("\n")

  let i = 0
  if (i >= lines.length || !(lines[i] ?? "").startsWith("WEBVTT")) {
    throw new VttParseError("Missing WEBVTT header")
  }
  i++

  // Skip header block (everything up to the first blank line).
  while (i < lines.length && (lines[i] ?? "").trim() !== "") i++

  const cues: RawCue[] = []
  while (i < lines.length) {
    // Skip blank separators.
    while (i < lines.length && (lines[i] ?? "").trim() === "") i++
    if (i >= lines.length) break

    // Optional cue identifier line: present if the *next* line is the timing header.
    let header = lines[i] ?? ""
    if (!header.includes("-->")) {
      // Identifier line; the next line should be the header.
      i++
      header = lines[i] ?? ""
      if (!header.includes("-->")) {
        throw new VttParseError(`Expected cue timing line, got ${JSON.stringify(header)}`)
      }
    }
    const { start_ms, end_ms } = parseCueHeader(header)
    i++

    const body: string[] = []
    while (i < lines.length && (lines[i] ?? "").trim() !== "") {
      body.push(lines[i] as string)
      i++
    }

    cues.push({ start_ms, end_ms, body })
  }

  return cues
}

function stripTags(s: string): string {
  return s.replace(ANY_TAG_RE, "").replace(/\s+/g, " ").trim()
}

function hasInlineTimingTag(line: string): boolean {
  INLINE_TS_RE.lastIndex = 0
  return INLINE_TS_RE.test(line)
}

function extractWordsFromLine(
  line: string,
  cueStart: number,
  startPosition: number,
): { text: string; start_ms: number }[] {
  // Build a list of (timestamp, chunkText) where the first chunk uses cueStart.
  const chunks: { start_ms: number; text: string }[] = []
  let lastIndex = 0
  let currentStart = cueStart

  INLINE_TS_RE.lastIndex = 0
  let m: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration idiom.
  while ((m = INLINE_TS_RE.exec(line)) !== null) {
    const before = line.slice(lastIndex, m.index)
    chunks.push({ start_ms: currentStart, text: before })
    currentStart = parseTimestamp(m[1] as string)
    lastIndex = INLINE_TS_RE.lastIndex
  }
  chunks.push({ start_ms: currentStart, text: line.slice(lastIndex) })

  // Strip remaining `<c>`/`</c>` etc. tags from each chunk, then split into whitespace-separated words.
  const words: { text: string; start_ms: number }[] = []
  for (const chunk of chunks) {
    const cleaned = chunk.text.replace(ANY_TAG_RE, "")
    const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0)
    for (const t of tokens) {
      words.push({ text: t, start_ms: chunk.start_ms })
    }
  }

  // position is assigned by the caller, so we just return texts here.
  void startPosition
  return words
}

export function parseVtt(raw: string): { segments: Segment[]; words: Word[] } {
  if (raw == null || raw.length === 0) {
    throw new VttParseError("Empty VTT input")
  }

  const cues = tokenizeCues(raw)

  if (cues.length === 0) {
    throw new VttParseError("No cues found in VTT")
  }

  const segments: Segment[] = []
  const words: Word[] = []
  let position = 0

  for (const cue of cues) {
    // Find the line(s) carrying new word-timing markup. YouTube auto-captions
    // place at most one such line per cue; carryover lines are plain text.
    const taggedLines = cue.body.filter((l) => hasInlineTimingTag(l))
    if (taggedLines.length === 0) continue

    const joined = taggedLines.join(" ")
    const text = stripTags(joined)
    if (text.length === 0) continue

    const segment: Segment = {
      start_ms: cue.start_ms,
      end_ms: cue.end_ms,
      text,
      words: [],
    }
    segments.push(segment)

    const rawWords: { text: string; start_ms: number }[] = []
    for (const line of taggedLines) {
      rawWords.push(...extractWordsFromLine(line, cue.start_ms, position))
    }

    for (let i = 0; i < rawWords.length; i++) {
      const w = rawWords[i] as { text: string; start_ms: number }
      const next = rawWords[i + 1]
      const end_ms = next ? next.start_ms : cue.end_ms
      const word: Word = {
        text: w.text,
        start_ms: w.start_ms,
        end_ms: Math.max(end_ms, w.start_ms),
        position,
      }
      segment.words.push(word)
      words.push(word)
      position++
    }
  }

  if (segments.length === 0) {
    throw new VttParseError("VTT contained no cues with word-timing markup")
  }

  return { segments, words }
}
