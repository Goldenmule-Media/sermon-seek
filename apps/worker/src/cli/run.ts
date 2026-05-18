import { createDb } from "@sermon-search/db"
import { ingestChannel } from "../ingest/channel.js"
import { ingestVideoTranscript } from "../ingest/transcript.js"
import { runSmokeTest } from "../smoke/index.js"
import { YoutubeClient } from "../youtube/client.js"

interface ParsedArgs {
  channel?: string
  video?: string
  smokeTest: boolean
}

const USAGE =
  "usage: worker:run (--channel <handle-or-id> | --video <youtube-video-id> | --smoke-test)"

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let channel: string | undefined
  let video: string | undefined
  let smokeTest = false
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
    if (arg === "--smoke-test") {
      smokeTest = true
      continue
    }
    if (arg?.startsWith("--smoke-test=")) {
      throw new Error("--smoke-test does not take a value")
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  const modes = [channel ? "--channel" : null, video ? "--video" : null, smokeTest ? "--smoke-test" : null].filter(
    (v): v is string => v !== null,
  )
  if (modes.length > 1) {
    throw new Error(`${modes.join(", ")} are mutually exclusive`)
  }
  if (modes.length === 0) {
    throw new Error(
      "Missing required --channel <handle-or-id>, --video <youtube-video-id>, or --smoke-test",
    )
  }
  return { channel, video, smokeTest }
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
    if (parsed.video) {
      const result = await ingestVideoTranscript({ db, client, youtubeVideoId: parsed.video })
      console.log(JSON.stringify(result, null, 2))
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
