import { createDb } from "@sermon-search/db"
import { ingestChannel } from "../ingest/channel.js"
import { YoutubeClient } from "../youtube/client.js"

interface ParsedArgs {
  channel: string
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let channel: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--") continue
    if (arg === "--channel") {
      const next = argv[i + 1]
      if (next === undefined) {
        throw new Error("--channel requires a value")
      }
      channel = next
      i += 1
      continue
    }
    if (arg?.startsWith("--channel=")) {
      channel = arg.slice("--channel=".length)
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  if (!channel) {
    throw new Error("Missing required --channel <handle-or-id>")
  }
  return { channel }
}

export async function main(argv: readonly string[]): Promise<number> {
  let parsed: ParsedArgs
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: worker:run --channel <handle-or-id>")
    return 2
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    console.error("YOUTUBE_API_KEY is not set")
    return 2
  }

  const client = new YoutubeClient({ apiKey })
  const db = createDb()
  try {
    const summary = await ingestChannel({ db, client, handleOrId: parsed.channel })
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
