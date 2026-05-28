import { Command } from "commander"
import { printAuditList, printJson } from "../output.js"
import { run } from "./_util.js"

export function makeAuditCommand(): Command {
  const cmd = new Command("audit").description("Admin audit log")

  cmd
    .command("list")
    .description("List audit log entries")
    .option("--action <action>", "Filter by action (e.g. request.approve)")
    .option("--target-type <type>", "Filter by target type (e.g. church)")
    .option("--user-id <id>", "Filter by user ID")
    .option("--limit <n>", "Max results (default 50)", (v) => Number.parseInt(v, 10))
    .option("--offset <n>", "Offset for pagination", (v) => Number.parseInt(v, 10))
    .action(
      async (
        opts: {
          action?: string
          targetType?: string
          userId?: string
          limit?: number
          offset?: number
        },
        self,
      ) => {
        await run(self, async (client, json) => {
          const data = await client.auditList({
            action: opts.action,
            target_type: opts.targetType,
            user_id: opts.userId,
            limit: opts.limit,
            offset: opts.offset,
          })
          if (json) printJson(data)
          else printAuditList(data)
        })
      },
    )

  return cmd
}
