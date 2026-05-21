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

// Build an OR-joined tsquery from free-form text by routing through
// plainto_tsquery (which strips stopwords and stems lexemes via the english
// config) and then converting its `&` AND-joins to `|`. Required for
// natural-language queries like "how does X choose Y?" — strict-AND drops to
// zero hits if any single content word is absent from a chunk; OR lets
// ts_rank_cd reward chunks that hit more terms and have them closer together.
function plainToOrTsquery(text: string): RawBuilder<string> {
  return sql`replace(plainto_tsquery('english', ${text})::text, ' & ', ' | ')::tsquery`
}

// Parse the user's query into a Postgres tsquery. A double-quoted segment
// becomes a `phraseto_tsquery` (adjacency-required) and is AND-combined with
// an OR-joined query over whatever non-quoted text remains. Without quotes
// the whole query is OR-joined content lexemes.
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
      tsquery: plainToOrTsquery(q),
      hasPhrases: false,
    }
  }

  const parts: RawBuilder<string>[] = phrases.map(
    (p) => sql`phraseto_tsquery('english', ${p})`,
  )
  if (remainder.length > 0) {
    parts.push(plainToOrTsquery(remainder))
  }

  let combined: RawBuilder<string> = parts[0]!
  for (let i = 1; i < parts.length; i++) {
    const next = parts[i]!
    combined = sql`(${combined} && ${next})`
  }

  return { tsquery: combined, hasPhrases: true }
}
