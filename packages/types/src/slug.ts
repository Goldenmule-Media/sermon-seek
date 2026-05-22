export const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export const RESERVED_SLUGS: readonly string[] = [
  "about",
  "privacy",
  "terms",
  "api",
  "admin",
  "health",
  "robots.txt",
  "sitemap.xml",
  "_next",
]

const RESERVED_SET = new Set(RESERVED_SLUGS)

export function validateSlug(
  slug: string,
): { ok: true } | { ok: false; reason: "format" | "reserved" } {
  if (RESERVED_SET.has(slug)) return { ok: false, reason: "reserved" }
  if (!SLUG_REGEX.test(slug)) return { ok: false, reason: "format" }
  return { ok: true }
}
