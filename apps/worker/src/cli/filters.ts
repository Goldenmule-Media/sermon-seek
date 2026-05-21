import { createDb } from "@sermon-search/db"
import type { ChannelFilterRuleRow, Database } from "@sermon-search/db"
import type { IngestionFilterRule } from "@sermon-search/types"
import type { Kysely } from "kysely"
import { validatePlaylistTarget } from "../ingest/filter_rules.js"
import { resolveChannel } from "../ingest/handle.js"
import { YoutubeClient } from "../youtube/client.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const FILTERS_USAGE = `usage: worker:run filters <subcommand> [options]

Subcommands:
  list    --channel <id|handle>
  add     --channel <id|handle> (--include | --exclude) --playlist <PL...> [--note <text>]
  remove  --rule-id <uuid>`

type FiltersSubcommand =
  | { subcommand: "list"; channel: string }
  | {
      subcommand: "add"
      channel: string
      ruleType: "include" | "exclude"
      playlist: string
      note?: string
    }
  | { subcommand: "remove"; ruleId: string }
  | { subcommand: "help" }

export function parseFiltersArgs(argv: readonly string[]): FiltersSubcommand {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { subcommand: "help" }
  }

  const sub = argv[0]
  const rest = argv.slice(1)

  if (sub === "list") return parseListArgs(rest)
  if (sub === "add") return parseAddArgs(rest)
  if (sub === "remove") return parseRemoveArgs(rest)
  throw new Error(`Unknown filters subcommand: ${sub}`)
}

function parseListArgs(argv: readonly string[]): { subcommand: "list"; channel: string } {
  let channel: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--channel") {
      const next = argv[i + 1]
      if (next === undefined) throw new Error("--channel requires a value")
      channel = next
      i++
    } else if (arg?.startsWith("--channel=")) {
      channel = arg.slice("--channel=".length)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!channel) throw new Error("--channel is required for filters list")
  return { subcommand: "list", channel }
}

function parseAddArgs(argv: readonly string[]): {
  subcommand: "add"
  channel: string
  ruleType: "include" | "exclude"
  playlist: string
  note?: string
} {
  let channel: string | undefined
  let include = false
  let exclude = false
  let playlist: string | undefined
  let note: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--channel") {
      const next = argv[i + 1]
      if (next === undefined) throw new Error("--channel requires a value")
      channel = next
      i++
    } else if (arg?.startsWith("--channel=")) {
      channel = arg.slice("--channel=".length)
    } else if (arg === "--include") {
      include = true
    } else if (arg === "--exclude") {
      exclude = true
    } else if (arg === "--playlist") {
      const next = argv[i + 1]
      if (next === undefined) throw new Error("--playlist requires a value")
      playlist = next
      i++
    } else if (arg?.startsWith("--playlist=")) {
      playlist = arg.slice("--playlist=".length)
    } else if (arg === "--note") {
      const next = argv[i + 1]
      if (next === undefined) throw new Error("--note requires a value")
      note = next
      i++
    } else if (arg?.startsWith("--note=")) {
      note = arg.slice("--note=".length)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!channel) throw new Error("--channel is required for filters add")
  if (!playlist) throw new Error("--playlist is required for filters add")
  if (include && exclude) throw new Error("--include and --exclude are mutually exclusive")
  if (!include && !exclude)
    throw new Error("Either --include or --exclude is required for filters add")

  return { subcommand: "add", channel, ruleType: include ? "include" : "exclude", playlist, note }
}

function parseRemoveArgs(argv: readonly string[]): { subcommand: "remove"; ruleId: string } {
  let ruleId: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--rule-id") {
      const next = argv[i + 1]
      if (next === undefined) throw new Error("--rule-id requires a value")
      ruleId = next
      i++
    } else if (arg?.startsWith("--rule-id=")) {
      ruleId = arg.slice("--rule-id=".length)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!ruleId) throw new Error("--rule-id is required for filters remove")
  return { subcommand: "remove", ruleId }
}

function toDto(row: ChannelFilterRuleRow): IngestionFilterRule {
  return {
    id: row.id,
    channel_id: row.channel_id,
    rule_type: row.rule_type,
    target_kind: row.target_kind,
    target_id: row.target_id,
    note: row.note,
    created_at: (row.created_at as unknown as Date).toISOString(),
  }
}

function getYoutubeClient(injected: YoutubeClient | undefined): YoutubeClient {
  if (injected) return injected
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not set")
  return new YoutubeClient({ apiKey })
}

export interface FiltersDeps {
  db?: Kysely<Database>
  client?: YoutubeClient
}

export async function runFiltersCli(
  argv: readonly string[],
  deps: FiltersDeps = {},
): Promise<number> {
  let parsed: FiltersSubcommand
  try {
    parsed = parseFiltersArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(FILTERS_USAGE)
    return 2
  }

  if (parsed.subcommand === "help") {
    console.log(FILTERS_USAGE)
    return 0
  }

  const db = deps.db ?? createDb()
  const ownDb = !deps.db

  try {
    if (parsed.subcommand === "list") {
      let channelId: string
      if (UUID_RE.test(parsed.channel)) {
        const channelRow = await db
          .selectFrom("channels")
          .select(["id"])
          .where("id", "=", parsed.channel)
          .executeTakeFirst()
        if (!channelRow) {
          console.error(`Channel not found: ${parsed.channel}`)
          return 1
        }
        channelId = channelRow.id
      } else {
        const client = getYoutubeClient(deps.client)
        const resolved = await resolveChannel(client, parsed.channel)
        const row = await db
          .selectFrom("channels")
          .select(["id"])
          .where("youtube_channel_id", "=", resolved.youtubeChannelId)
          .executeTakeFirst()
        if (!row) {
          console.error(`Channel not found in DB: ${parsed.channel}`)
          return 1
        }
        channelId = row.id
      }

      const rows = await db
        .selectFrom("channel_filter_rules")
        .selectAll()
        .where("channel_id", "=", channelId)
        .orderBy("created_at", "asc")
        .execute()
      console.log(JSON.stringify({ rules: rows.map(toDto) }, null, 2))
      return 0
    }

    if (parsed.subcommand === "remove") {
      const deleted = await db
        .deleteFrom("channel_filter_rules")
        .where("id", "=", parsed.ruleId)
        .returning(["id", "channel_id"])
        .executeTakeFirst()
      if (!deleted) {
        console.error(`rule not found: ${parsed.ruleId}`)
        return 1
      }
      console.log(JSON.stringify({ ok: true, deleted: deleted.id, channel_id: deleted.channel_id }, null, 2))
      return 0
    }

    // add
    let channelId: string
    let youtubeChannelId: string

    if (UUID_RE.test(parsed.channel)) {
      channelId = parsed.channel
      const channelRow = await db
        .selectFrom("channels")
        .select(["youtube_channel_id"])
        .where("id", "=", channelId)
        .executeTakeFirst()
      if (!channelRow) {
        console.error(`Channel not found: ${channelId}`)
        return 1
      }
      youtubeChannelId = channelRow.youtube_channel_id
    } else {
      const resolved = await resolveChannel(getYoutubeClient(deps.client), parsed.channel)
      youtubeChannelId = resolved.youtubeChannelId
      const channelRow = await db
        .selectFrom("channels")
        .select(["id"])
        .where("youtube_channel_id", "=", youtubeChannelId)
        .executeTakeFirst()
      if (!channelRow) {
        console.error(`Channel not found in DB: ${parsed.channel}`)
        return 1
      }
      channelId = channelRow.id
    }

    const client = getYoutubeClient(deps.client)
    const validation = await validatePlaylistTarget({
      youtube: client,
      youtubeChannelId,
      targetId: parsed.playlist,
    })
    if (!validation.ok) {
      console.error(validation.message)
      return 1
    }

    const oppositeType = parsed.ruleType === "include" ? "exclude" : "include"
    const conflicting = await db
      .selectFrom("channel_filter_rules")
      .select(["id"])
      .where("channel_id", "=", channelId)
      .where("target_kind", "=", "playlist")
      .where("target_id", "=", parsed.playlist)
      .where("rule_type", "=", oppositeType)
      .executeTakeFirst()

    try {
      const row = await db
        .insertInto("channel_filter_rules")
        .values({
          channel_id: channelId,
          rule_type: parsed.ruleType,
          target_kind: "playlist",
          target_id: parsed.playlist,
          note: parsed.note ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
      console.log(JSON.stringify(toDto(row), null, 2))
      if (conflicting) {
        console.error(
          `warning: an ${oppositeType} rule for playlist ${parsed.playlist} already exists; the include rule will win at enforcement time`,
        )
      }
      return 0
    } catch (err) {
      const pgErr = err as { code?: string }
      if (pgErr.code === "23505") {
        console.error(
          `rule already exists for channel ${channelId} (${parsed.ruleType} playlist ${parsed.playlist})`,
        )
        return 1
      }
      throw err
    }
  } catch (err) {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
    return 1
  } finally {
    if (ownDb) await db.destroy()
  }
}
