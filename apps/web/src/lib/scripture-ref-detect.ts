// Detects whether a query string looks like a scripture reference (e.g. "Romans 8", "1 Cor 13:4-7").
// Intentionally permissive — the API is authoritative. This only decides which query param to use.
const REF_RE = /^(?:(?:1|2|3|i{1,3}|first|second|third)\s+)?(?!chapter\b)[a-z]{2,}\s+\d/i

export function isRefLike(query: string): boolean {
  return REF_RE.test(query.trim())
}
