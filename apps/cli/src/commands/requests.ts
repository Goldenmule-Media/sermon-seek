import { Command } from "commander"
import { printJson, printRequestDetail, printRequestList } from "../output.js"
import { run } from "./_util.js"

export function makeRequestsCommand(): Command {
  const cmd = new Command("requests").description("Ingestion request management")

  cmd
    .command("list")
    .description("List ingestion requests")
    .option("--status <status>", "Filter by status")
    .option("--user-id <id>", "Filter by user ID")
    .option("--limit <n>", "Max results (default 20)", (v) => Number.parseInt(v, 10))
    .option("--offset <n>", "Offset for pagination", (v) => Number.parseInt(v, 10))
    .action(
      async (opts: { status?: string; userId?: string; limit?: number; offset?: number }, self) => {
        await run(self, async (client, json) => {
          const data = await client.requestsList({
            status: opts.status,
            user_id: opts.userId,
            limit: opts.limit,
            offset: opts.offset,
          })
          if (json) printJson(data)
          else printRequestList(data)
        })
      },
    )

  cmd
    .command("get <id>")
    .description("Get ingestion request detail")
    .action(async (id: string, _opts, self) => {
      await run(self, async (client, json) => {
        const data = await client.requestGet(id)
        if (json) printJson(data)
        else printRequestDetail(data)
      })
    })

  cmd
    .command("approve <id>")
    .description("Approve an ingestion request")
    .action(async (id: string, _opts, self) => {
      await run(self, async (client, json) => {
        const data = await client.requestApprove(id)
        if (json) printJson(data)
        else console.log(`Request ${data.id} is now ${data.status}.`)
      })
    })

  cmd
    .command("deny <id>")
    .description("Deny an ingestion request")
    .requiredOption("--note <text>", "Admin note (required)")
    .action(async (id: string, opts: { note: string }, self) => {
      await run(self, async (client, json) => {
        const data = await client.requestDeny(id, opts.note)
        if (json) printJson(data)
        else console.log(`Request ${data.id} is now ${data.status}.`)
      })
    })

  cmd
    .command("retry <id>")
    .description("Retry a failed ingestion request (re-queues it for the worker)")
    .action(async (id: string, _opts, self) => {
      await run(self, async (client, json) => {
        const data = await client.requestRetry(id)
        if (json) printJson(data)
        else console.log(`Request ${data.id} is now ${data.status}.`)
      })
    })

  return cmd
}
