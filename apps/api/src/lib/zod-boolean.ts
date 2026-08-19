import { z } from "zod"

const TRUE_VALUES = new Set(["true", "1", "yes", "on"])
const FALSE_VALUES = new Set(["false", "0", "no", "off", ""])

/**
 * A boolean parsed from a string — a query parameter or an environment variable.
 *
 * `z.coerce.boolean()` is the wrong tool for these: it applies JavaScript's
 * `Boolean(value)`, so every non-empty string is true. `?has_transcript=false`
 * and `COOKIE_SECURE=false` both came out true, which is the opposite of what
 * the caller asked for and fails silently.
 *
 * Real booleans pass through, so this is also safe on values that some other
 * layer has already parsed.
 */
export function booleanish() {
  return z.preprocess((value) => {
    if (typeof value === "boolean") return value
    if (typeof value !== "string") return value
    const normalized = value.trim().toLowerCase()
    if (TRUE_VALUES.has(normalized)) return true
    if (FALSE_VALUES.has(normalized)) return false
    return value
  }, z.boolean())
}
