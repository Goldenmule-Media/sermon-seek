// Run ./calibrate-token-cap.ts to re-derive this value from the Jubilee corpus.
import { getEncoding } from "js-tiktoken"

// Sum of cl100k_base tokens across the 25 most-recently-ingested Jubilee transcripts.
// Update this integer by running: pnpm --filter @sermon-search/worker calibrate-token-cap
export const LIMITED_INGEST_TOKEN_CAP_DEFAULT = 250_000

const enc = getEncoding("cl100k_base")

export function countTranscriptTokens(text: string): number {
  return enc.encode(text).length
}
