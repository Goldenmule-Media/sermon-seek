export function formatTimestamp(iso: string | null): string {
  if (iso == null) return "Never"
  return new Date(iso).toLocaleString()
}

export function isStale(iso: string | null, maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  return iso == null || Date.now() - Date.parse(iso) > maxAgeMs
}
