import { type RawBuilder, sql } from "kysely"

export interface BuiltQuery {
  // tsquery SQL fragment, suitable both as `c.text_tsv @@ ${tsquery}` and as
  // the second argument to ts_headline / ts_rank_cd.
  tsquery: RawBuilder<string>
  // True when the user's query contained at least one double-quoted phrase.
  // Callers can use this to dial down loosely-matched signals (e.g. semantic
  // rerank weight) so an opt-in phrase actually narrows results.
  hasPhrases: boolean
}

const QUOTED = /"([^"]+)"/g

// Parse the user's query into a Postgres tsquery. A double-quoted segment
// becomes a `phraseto_tsquery` (adjacency-required) and is AND-combined with a
// `plainto_tsquery` over whatever non-quoted text remains. Without quotes the
// behavior is identical to plainto_tsquery.
export function buildTsQuery(q: string): BuiltQuery {
  const phrases: string[] = []
  const remainder = q
    .replace(QUOTED, (_m, captured) => {
      const trimmed = String(captured).trim()
      if (trimmed.length > 0) phrases.push(trimmed)
      return " "
    })
    .replace(/\s+/g, " ")
    .trim()

  if (phrases.length === 0) {
    return {
      tsquery: sql`plainto_tsquery('english', ${q})`,
      hasPhrases: false,
    }
  }

  const parts: RawBuilder<string>[] = phrases.map(
    (p) => sql`phraseto_tsquery('english', ${p})`,
  )
  if (remainder.length > 0) {
    parts.push(sql`plainto_tsquery('english', ${remainder})`)
  }

  let combined: RawBuilder<string> = parts[0]!
  for (let i = 1; i < parts.length; i++) {
    const next = parts[i]!
    combined = sql`(${combined} && ${next})`
  }

  return { tsquery: combined, hasPhrases: true }
}
