import { Command } from "commander"
import { createClient } from "../client.js"
import type { ResolvedInstance } from "../instance.js"
import { resolveInstance } from "../instance.js"
import { LOG_LEVEL_LABELS, streamLogs } from "../logs.js"
import type { LogLevelLabel } from "../logs.js"
import { printLogRecord } from "../output.js"

interface GlobalOpts {
  instance?: string
  json?: boolean
  url?: string
  key?: string
}

function parseLevel(value: string): LogLevelLabel {
  if ((LOG_LEVEL_LABELS as readonly string[]).includes(value)) {
    return value as LogLevelLabel
  }
  throw new Error(`Invalid level "${value}". Valid values: ${LOG_LEVEL_LABELS.join(", ")}`)
}

function parseSince(value: string): string {
  if (/^\d+[smh]$/.test(value)) return value
  throw new Error(`Invalid --since "${value}". Use a value like 5m, 30s, or 2h.`)
}

export function makeLogsCommand(): Command {
  const cmd = new Command("logs").description("Log operations")

  cmd
    .command("tail")
    .description("Print recent log records, optionally streaming live with --follow")
    .option("--follow", "Stream live log records until Ctrl-C (reconnects on transient drop)")
    .option(
      "--level <level>",
      `Minimum log level to display (${LOG_LEVEL_LABELS.join("|")})`,
      parseLevel,
    )
    .option(
      "--since <dur>",
      "Show only records from the past duration (e.g. 5m, 30s, 2h)",
      parseSince,
    )
    .action(
      async (opts: { follow?: boolean; level?: LogLevelLabel; since?: string }, cmd: Command) => {
        const globals = cmd.optsWithGlobals<GlobalOpts>()

        let instance: ResolvedInstance
        try {
          instance = resolveInstance({
            instance: globals.instance,
            url: globals.url,
            key: globals.key,
          })
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err))
          process.exit(1)
        }

        const json = globals.json ?? false
        const query = { level: opts.level, since: opts.since }

        if (!opts.follow) {
          const client = createClient(instance)
          try {
            const records = await client.recentLogs(query)
            if (records.length === 0 && !json) {
              console.error("No recent log records.")
              return
            }
            for (const rec of records) {
              printLogRecord(rec, { json })
            }
          } catch (err) {
            console.error(err instanceof Error ? err.message : String(err))
            process.exit(1)
          }
          return
        }

        // Follow mode — stream until Ctrl-C
        const controller = new AbortController()
        process.on("SIGINT", () => {
          controller.abort()
          process.exit(0)
        })

        try {
          await streamLogs(instance, query, {
            onRecord: (rec) => printLogRecord(rec, { json }),
            onNotice: (msg) => console.error(msg),
            signal: controller.signal,
          })
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err))
          process.exit(1)
        }
      },
    )

  return cmd
}
