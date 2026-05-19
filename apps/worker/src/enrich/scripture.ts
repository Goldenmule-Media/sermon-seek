export const SCRIPTURE_REF_REGEX = /^[1-3]? ?[A-Z][a-z]+ \d+(:\d+(-\d+)?)?$/

export function filterScriptureRefs(refs: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of refs) {
    const trimmed = raw.trim()
    if (seen.has(trimmed)) continue
    if (!SCRIPTURE_REF_REGEX.test(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= 3) break
  }
  return result
}
