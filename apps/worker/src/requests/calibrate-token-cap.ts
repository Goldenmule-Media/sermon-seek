// Re-derives LIMITED_INGEST_TOKEN_CAP_DEFAULT from the local Jubilee corpus.
//
// Usage:
//   pnpm --filter @sermon-search/worker calibrate-token-cap
//
// Sums cl100k_base tokens across the 25 most-recently-ingested Jubilee
// transcripts and prints the integer. Update LIMITED_INGEST_TOKEN_CAP_DEFAULT
// in ./limited-ingest-token-cap.ts with the printed value.
import { createDb } from "@sermon-search/db"
import { countTranscriptTokens } from "./limited-ingest-token-cap.js"

const JUBILEE_SLUG = "jubileestl"
const SAMPLE_SIZE = 25

async function main(): Promise<void> {
  const db = createDb()
  try {
    const church = await db
      .selectFrom("churches")
      .select("id")
      .where("slug", "=", JUBILEE_SLUG)
      .executeTakeFirst()

    if (!church) {
      console.error(`Church '${JUBILEE_SLUG}' not found. Is the local DB seeded with Jubilee data?`)
      process.exit(1)
    }

    const rows = await db
      .selectFrom("transcripts as t")
      .innerJoin("videos as v", "v.id", "t.video_id")
      .select(["t.full_text", "v.youtube_video_id", "v.title", "t.created_at"])
      .where("v.church_id", "=", church.id)
      .orderBy("t.created_at", "desc")
      .limit(SAMPLE_SIZE)
      .execute()

    if (rows.length < SAMPLE_SIZE) {
      console.error(
        `Only ${rows.length} Jubilee transcripts found; need ${SAMPLE_SIZE} for a reliable calibration. Ingest more videos and retry.`,
      )
      process.exit(1)
    }

    let total = 0
    for (const row of rows) {
      const tokens = countTranscriptTokens(row.full_text)
      total += tokens
      console.log(`  ${tokens.toString().padStart(7)}  ${row.youtube_video_id}  ${row.title ?? ""}`)
    }

    console.log("")
    console.log(`Videos sampled : ${rows.length}`)
    console.log(`Total tokens   : ${total}`)
    console.log("")
    console.log("Paste into apps/worker/src/requests/limited-ingest-token-cap.ts:")
    console.log(`  export const LIMITED_INGEST_TOKEN_CAP_DEFAULT = ${total}`)
  } finally {
    await db.destroy()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
