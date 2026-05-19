export const TOP_N_PER_SIGNAL = 8

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let intersectionCount = 0
  for (const x of setA) {
    if (setB.has(x)) intersectionCount++
  }
  const unionCount = setA.size + setB.size - intersectionCount
  return unionCount === 0 ? 0 : intersectionCount / unionCount
}

export function pickQuotedSnippet(text: string, maxChars = 180): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  const candidate = trimmed.slice(0, maxChars)
  const sentenceMatch = candidate.match(/^(.*?[.!?])\s/)
  if (sentenceMatch?.[1]) return sentenceMatch[1]
  const lastSpace = candidate.lastIndexOf(" ")
  return lastSpace > 0 ? candidate.slice(0, lastSpace) : candidate
}

export function topN<T extends { score: number }>(items: T[], n = TOP_N_PER_SIGNAL): T[] {
  return items
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
}
