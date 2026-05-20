// Dry-run the enricher against one or more videos and print the result.
// Does not write to the database. Useful for prompt iteration.
//
// Usage:
//   pnpm --filter @sermon-search/worker enrich:preview -- <youtube-video-id> [<id> ...]
import { createDb } from "@sermon-search/db"
import { createOpenAIEnricher } from "../enrich/llm.js"

async function main(): Promise<void> {
  const ids = process.argv.slice(2).filter((a) => a && !a.startsWith("-") && a !== "--")
  if (ids.length === 0) {
    console.error(
      "usage: enrich:preview <youtube-video-id> [<youtube-video-id> ...]",
    )
    process.exit(1)
  }

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error("DATABASE_URL is required")
    process.exit(1)
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error("OPENAI_API_KEY is required")
    process.exit(1)
  }

  const db = createDb(dbUrl)
  const enricher = createOpenAIEnricher({ apiKey })

  try {
    for (const youtubeId of ids) {
      const video = await db
        .selectFrom("videos")
        .select(["id", "youtube_video_id", "title"])
        .where("youtube_video_id", "=", youtubeId)
        .executeTakeFirst()

      if (!video) {
        console.log(`\n=== ${youtubeId} ===\n(not found)`)
        continue
      }

      const transcript = await db
        .selectFrom("transcripts")
        .select(["full_text"])
        .where("video_id", "=", video.id)
        .orderBy("created_at", "desc")
        .executeTakeFirst()

      if (!transcript) {
        console.log(`\n=== ${youtubeId} — ${video.title} ===\n(no transcript)`)
        continue
      }

      const output = await enricher.enrich(transcript.full_text, video.title)
      console.log(`\n=== ${youtubeId} — ${video.title} ===`)
      console.log(`summary (${output.summary.length} chars): ${output.summary}`)
      console.log(`topics: ${output.topics.join(", ")}`)
    }
  } finally {
    await db.destroy()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
