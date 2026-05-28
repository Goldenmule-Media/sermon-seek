import { createInterface } from "node:readline/promises"
import { Command } from "commander"
import { createClient } from "../client.js"
import { loadConfig, saveConfig, setInstance, useInstance } from "../config/store.js"

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(question)
    return answer.trim()
  } finally {
    rl.close()
  }
}

export function makeLoginCommand(): Command {
  return new Command("login")
    .description("Interactively set up and verify an instance, then save it")
    .option("--url <baseUrl>", "Base URL (skip prompt)")
    .option("--key <adminKey>", "Admin key (skip prompt)")
    .option("--instance <name>", "Instance name to save as (default: prompted)")
    .action(async (opts: { url?: string; key?: string; instance?: string }) => {
      const baseUrl = opts.url ?? (await prompt("API base URL (e.g. http://localhost:3001): "))
      const adminKey = opts.key ?? (await prompt("Admin API key: "))
      const name =
        opts.instance ?? (await prompt('Instance name to save as (e.g. "local", "prod"): '))

      if (!baseUrl) {
        console.error("Base URL is required.")
        process.exit(1)
      }
      if (!adminKey) {
        console.error("Admin key is required.")
        process.exit(1)
      }
      if (!name) {
        console.error("Instance name is required.")
        process.exit(1)
      }

      console.log(`Verifying connection to ${baseUrl}…`)
      const client = createClient({ name, baseUrl, adminKey })
      try {
        await client.health()
      } catch (err) {
        console.error(`Login failed: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }

      let cfg = loadConfig()
      cfg = setInstance(cfg, name, { baseUrl, adminKey })
      cfg = useInstance(cfg, name)
      await saveConfig(cfg)
      console.log(`Logged in. Instance "${name}" saved and set as current.`)
    })
}
