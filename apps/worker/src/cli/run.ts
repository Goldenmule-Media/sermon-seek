import { createDb } from "@sermon-search/db"
import { createOpenAIEmbedder } from "@sermon-search/embeddings"
import { createOpenAIEnricher } from "../enrich/llm.js"
import { runEnrichBackfill } from "../enrich/run.js"
import { ingestChannel } from "../ingest/channel.js"
import { runEmbedBackfill } from "../ingest/embed.js"
import { ingestPlaylist } from "../ingest/playlist.js"
import { ingestVideoTranscript } from "../ingest/transcript.js"
import { runViewStats } from "../ingest/view_stats.js"
import { runRelatedBackfill } from "../related/run.js"
import { runSmokeTest } from "../smoke/index.js"
import { YoutubeClient } from "../youtube/client.js"

interface ParsedArgs {
  channel?: string
  video?: string
  playlist?: string
  smokeTest: boolean
  viewStats: boolean
  embed: boolean
  enrich: boolean
  related: boolean
  force: boolean
}

const USAGE =
  "usage: worker:run (--channel <handle-or-id> | --video <youtube-video-id> | --playlist <youtube-playlist-id> | --smoke-test | --view-stats | --embed | --enrich [--force] | --related [--force])"

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let channel: string | undefined
  let video: string | undefined
  let playlist: string | undefined
  let smokeTest = false
  let viewStats = false
  let embed = false
  let enrich = false
  let related = false
  let force = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--") continue
    if (arg === "--channel") {
      const next = argv[i + 1]
      if (next === undefined) throw new Error("--channel requires a value")
      channel = next
      i += 1
      continue
    }
    if (arg?.startsWith("--channel=")) {
      channel = arg.slice("--channel=".length)
      continue
    }
    if (arg === "--video") {
      const next = argv[i + 1]
      if (next === undefined) throw new Error("--video requires a value")
      video = next
      i += 1
      continue
    }
    if (arg?.startsWith("--video=")) {
      video = arg.slice("--video=".length)
      continue
    }
    if (arg === "--playlist") {
      const next = argv[i + 1]
      if (next === undefined) throw new Error("--playlist requires a value")
      playlist = next
      i += 1
      continue
    }
    if (arg?.startsWith("--playlist=")) {
      playlist = arg.slice("--playlist=".length)
      continue
    }
    if (arg === "--smoke-test") {
      smokeTest = true
      continue
    }
    if (arg?.startsWith("--smoke-test=")) {
      throw new Error("--smoke-test does not take a value")
    }
    if (arg === "--view-stats") {
      viewStats = true
      continue
    }
    if (arg?.startsWith("--view-stats=")) {
      throw new Error("--view-stats does not take a value")
    }
    if (arg === "--embed") {
      embed = true
      continue
    }
    if (arg?.startsWith("--embed=")) {
      throw new Error("--embed does not take a value")
    }
    if (arg === "--enrich") {
      enrich = true
      continue
    }
    if (arg?.startsWith("--enrich=")) {
      throw new Error("--enrich does not take a value")
    }
    if (arg === "--related") {
      related = true
      continue
    }
    if (arg?.startsWith("--related=")) {
      throw new Error("--related does not take a value")
    }
    if (arg === "--force") {
      force = true
      continue
    }
    if (arg?.startsWith("--force=")) {
      throw new Error("--force does not take a value")
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  if (force && !enrich && !related) {
    throw new Error("--force requires --enrich or --related")
  }
  const modes = [
    channel ? "--channel" : null,
    video ? "--video" : null,
    playlist ? "--playlist" : null,
    smokeTest ? "--smoke-test" : null,
    viewStats ? "--view-stats" : null,
    embed ? "--embed" : null,
    enrich ? "--enrich" : null,
    related ? "--related" : null,
  ].filter((v): v is string => v !== null)
  if (modes.length > 1) {
    throw new Error(`${modes.join(", ")} are mutually exclusive`)
  }
  if (modes.length === 0) {
    throw new Error(
      "Missing required --channel <handle-or-id>, --video <youtube-video-id>, --playlist <youtube-playlist-id>, --smoke-test, --view-stats, --embed, --enrich, or --related",
    )
  }
  return { channel, video, playlist, smokeTest, viewStats, embed, enrich, related, force }
}

export async function main(argv: readonly string[]): Promise<number> {
  let parsed: ParsedArgs
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(USAGE)
    return 2
  }

  if (parsed.embed) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      console.error("OPENAI_API_KEY is not set")
      return 2
    }
    const db = createDb()
    try {
      const embedder = createOpenAIEmbedder({ apiKey })
      const summary = await runEmbedBackfill({ db, embedder, log: console.log })
      console.log(JSON.stringify(summary, null, 2))
      return 0
    } catch (err) {
      console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
      return 1
    } finally {
      await db.destroy()
    }
  }

  if (parsed.enrich) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      console.error("OPENAI_API_KEY is not set")
      return 2
    }
    const model = process.env.ENRICHMENT_MODEL ?? "gpt-4o-mini"
    const db = createDb()
    try {
      const enricher = createOpenAIEnricher({ apiKey, model })
      const summary = await runEnrichBackfill({
        db,
        enricher,
        force: parsed.force,
        log: console.log,
      })
      console.log(JSON.stringify(summary, null, 2))
      return 0
    } catch (err) {
      console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
      return 1
    } finally {
      await db.destroy()
    }
  }

  if (parsed.related) {
    const db = createDb()
    try {
      const summary = await runRelatedBackfill({ db, force: parsed.force, log: console.log })
      console.log(JSON.stringify(summary, null, 2))
      return 0
    } catch (err) {
      console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
      return 1
    } finally {
      await db.destroy()
    }
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    console.error("YOUTUBE_API_KEY is not set")
    return 2
  }

  const client = new YoutubeClient({ apiKey })

  if (parsed.smokeTest) {
    const result = await runSmokeTest({ client })
    return result.exitCode
  }

  const db = createDb()
  try {
    if (parsed.viewStats) {
      const summary = await runViewStats({ db, client })
      console.log(JSON.stringify(summary, null, 2))
      return 0
    }
    if (parsed.video) {
      const result = await ingestVideoTranscript({ db, client, youtubeVideoId: parsed.video })
      console.log(JSON.stringify(result, null, 2))
      return 0
    }
    if (parsed.playlist) {
      const summary = await ingestPlaylist({ db, client, youtubePlaylistId: parsed.playlist })
      console.log(JSON.stringify(summary, null, 2))
      return 0
    }
    const summary = await ingestChannel({ db, client, handleOrId: parsed.channel as string })
    console.log(JSON.stringify(summary, null, 2))
    return 0
  } catch (err) {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
    return 1
  } finally {
    await db.destroy()
  }
}

const invokedDirectly = (() => {
  try {
    const entryHref = process.argv[1]
    if (!entryHref) return false
    return import.meta.url === new URL(`file://${entryHref}`).href
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  void main(process.argv.slice(2)).then((code) => {
    process.exit(code)
  })
}
