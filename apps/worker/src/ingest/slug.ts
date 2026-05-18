export function baseSlug(title: string): string {
  const folded = title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
  const dashed = folded.replace(/[^a-z0-9]+/g, "-")
  const trimmed = dashed.replace(/^-+|-+$/g, "")
  return trimmed.length > 0 ? trimmed : "playlist"
}

export function disambiguatedSlug(title: string, youtubePlaylistId: string): string {
  const suffix = youtubePlaylistId.slice(-6).toLowerCase()
  return `${baseSlug(title)}-${suffix}`
}

export function uniqueSlugForPlaylist(
  title: string,
  youtubePlaylistId: string,
  takenSlugs: ReadonlySet<string>,
): string {
  const base = baseSlug(title)
  if (!takenSlugs.has(base)) return base
  return disambiguatedSlug(title, youtubePlaylistId)
}
