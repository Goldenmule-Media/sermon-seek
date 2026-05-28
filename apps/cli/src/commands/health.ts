import { Command } from "commander"
import { createClient } from "../client.js"
import { type ResolvedInstance, resolveInstance } from "../instance.js"
import { printHealth, printJson } from "../output.js"

interface GlobalOpts {
  instance?: string
  json?: boolean
  url?: string
  key?: string
}

export function makeHealthCommand(): Command {
  return new Command("health")
    .description("Check the health of the target instance")
    .action(async (_opts, cmd: Command) => {
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

      const client = createClient(instance)
      try {
        const data = await client.health()
        if (globals.json) {
          printJson(data)
        } else {
          printHealth(data)
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })
}
