const DURATION_RE = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

export function iso8601DurationToSeconds(input: string): number {
  const match = input.match(DURATION_RE)
  if (!match) {
    throw new Error(`Invalid ISO 8601 duration: ${JSON.stringify(input)}`)
  }
  const days = match[1] ? Number.parseInt(match[1], 10) : 0
  const hours = match[2] ? Number.parseInt(match[2], 10) : 0
  const minutes = match[3] ? Number.parseInt(match[3], 10) : 0
  const seconds = match[4] ? Number.parseInt(match[4], 10) : 0
  return days * 86400 + hours * 3600 + minutes * 60 + seconds
}
