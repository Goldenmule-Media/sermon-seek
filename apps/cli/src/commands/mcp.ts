import { Command } from "commander"
import { resolveInstance } from "../instance.js"
import { runMcpServer } from "../mcp.js"

interface GlobalOpts {
  instance?: string
  url?: string
  key?: string
}

export function makeMcpCommand(): Command {
  return new Command("mcp")
    .description("Run as an stdio MCP server exposing admin actions as tools")
    .action(async (_opts, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOpts>()

      let instance: ReturnType<typeof resolveInstance>
      try {
        instance = resolveInstance({
          instance: globals.instance,
          url: globals.url,
          key: globals.key,
        })
      } catch (err) {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
        process.exit(1)
      }

      await runMcpServer(instance)
    })
}
