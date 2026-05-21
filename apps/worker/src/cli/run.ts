import { createDb } from "@sermon-search/db"
import { createOpenAIEmbedder } from "@sermon-search/embeddings"
import { createOpenAIEnricher } from "../enrich/llm.js"
import { runEnrichBackfill } from "../enrich/run.js"
import { ingestChannel } from "../ingest/channel.js"
import { runEmbedBackfill } from "../ingest/embed.js"
import { ingestPlaylist } from "../ingest/playlist.js"
import { runRechunk } from "../ingest/rechunk.js"
import { ingestVideoTranscript } from "../ingest/transcript.js"
import { runTranscriptsBackfill } from "../ingest/transcripts_backfill.js"
import { runViewStats } from "../ingest/view_stats.js"
import { runRelatedBackfill } from "../related/run.js"
import { runSmokeTest } from "../smoke/index.js"
import { YoutubeClient } from "../youtube/client.js"
import { runFiltersCli } from "./filters.js"

interface ParsedArgs {
  channel?: string
  video?: string
  playlist?: string
  church?: string
  smokeTest: boolean
  viewStats: boolean
  transcripts: boolean
  embed: boolean
  rechunk: boolean
  enrich: boolean
  related: boolean
  force: boolean
}

const USAGE =
  "usage: worker:run --church <slug> (--channel <handle-or-id> | --video <youtube-video-id> | --playlist <youtube-playlist-id> | --view-stats | --transcripts | --embed | --rechunk | --enrich [--force] | --related [--force]) | --smoke-test | filters list|add|remove"

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let channel: string | undefined
  let video: string | undefined
  let playlist: string | undefined
  let church: string | undefined
  let smokeTest = false
  let viewStats = false
  let transcripts = false
  let embed = false
  let rechunk = false
  let enrich = false
  let related = false
  let force = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--") continue
    if (arg === "--church") {
      const next = argv[i + 1]
      if (next === undefined) throw new Error("--church requires a value")
      church = next
      i += 1
      continue
    }
    if (arg?.startsWith("--church=")) {
      church = arg.slice("--church=".length)
      continue
    }
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
    if (arg === "--transcripts") {
      transcripts = true
      continue
    }
    if (arg?.startsWith("--transcripts=")) {
      throw new Error("--transcripts does not take a value")
    }
    if (arg === "--embed") {
      embed = true
      continue
    }
    if (arg?.startsWith("--embed=")) {
      throw new Error("--embed does not take a value")
    }
    if (arg === "--rechunk") {
      rechunk = true
      continue
    }
    if (arg?.startsWith("--rechunk=")) {
      throw new Error("--rechunk does not take a value")
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
    transcripts ? "--transcripts" : null,
    embed ? "--embed" : null,
    rechunk ? "--rechunk" : null,
    enrich ? "--enrich" : null,
    related ? "--related" : null,
  ].filter((v): v is string => v !== null)
  if (modes.length > 1) {
    throw new Error(`${modes.join(", ")} are mutually exclusive`)
  }
  if (modes.length === 0) {
    throw new Error(
      "Missing required --channel <handle-or-id>, --video <youtube-video-id>, --playlist <youtube-playlist-id>, --smoke-test, --view-stats, --transcripts, --embed, --rechunk, --enrich, or --related",
    )
  }
  return {
    channel,
    video,
    playlist,
    church,
    smokeTest,
    viewStats,
    transcripts,
    embed,
    rechunk,
    enrich,
    related,
    force,
  }
}

async function resolveChurchId(db: ReturnType<typeof createDb>, slug: string): Promise<string> {
  const row = await db
    .selectFrom("churches")
    .select(["id"])
    .where("slug", "=", slug)
    .executeTakeFirst()
  if (!row) throw new Error(`Unknown church: ${slug}`)
  return row.id
}

export async function main(argv: readonly string[]): Promise<number> {
  if (argv[0] === "filters") {
    return runFiltersCli(argv.slice(1))
  }

  let parsed: ParsedArgs
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(USAGE)
    return 2
  }

  if (!parsed.smokeTest && !parsed.church) {
    console.error("--church <slug> is required for this command")
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
      const churchId = await resolveChurchId(db, parsed.church as string)
      const embedder = createOpenAIEmbedder({ apiKey })
      const summary = await runEmbedBackfill({ db, embedder, churchId, log: console.log })
      console.log(JSON.stringify(summary, null, 2))
      return 0
    } catch (err) {
      console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
      return 1
    } finally {
      await db.destroy()
    }
  }

  if (parsed.rechunk) {
    const db = createDb()
    try {
      const churchId = await resolveChurchId(db, parsed.church as string)
      const summary = await runRechunk({ db, churchId, log: console.log })
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
      const churchId = await resolveChurchId(db, parsed.church as string)
      const enricher = createOpenAIEnricher({ apiKey, model })
      const summary = await runEnrichBackfill({
        db,
        enricher,
        churchId,
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
      const churchId = await resolveChurchId(db, parsed.church as string)
      const summary = await runRelatedBackfill({ db, churchId, force: parsed.force, log: console.log })
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
    const churchId = await resolveChurchId(db, parsed.church as string)
    if (parsed.viewStats) {
      const summary = await runViewStats({ db, client, churchId })
      console.log(JSON.stringify(summary, null, 2))
      return 0
    }
    if (parsed.video) {
      const result = await ingestVideoTranscript({
        db,
        client,
        youtubeVideoId: parsed.video,
        churchId,
      })
      console.log(JSON.stringify(result, null, 2))
      return 0
    }
    if (parsed.playlist) {
      const summary = await ingestPlaylist({
        db,
        client,
        youtubePlaylistId: parsed.playlist,
        churchId,
      })
      console.log(JSON.stringify(summary, null, 2))
      return 0
    }
    if (parsed.transcripts) {
      const summary = await runTranscriptsBackfill({ db, client, churchId, log: console.log })
      console.log(JSON.stringify(summary, null, 2))
      return 0
    }
    const summary = await ingestChannel({
      db,
      client,
      handleOrId: parsed.channel as string,
      churchId,
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
