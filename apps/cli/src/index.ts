#!/usr/bin/env node
import { Command } from "commander"
import { makeConfigCommand } from "./commands/config.js"
import { makeHealthCommand } from "./commands/health.js"
import { makeLoginCommand } from "./commands/login.js"
import { makeLogsCommand } from "./commands/logs.js"
import { makeMcpCommand } from "./commands/mcp.js"

const program = new Command()
  .name("sermon-admin")
  .description("Admin CLI for Sermon-Search instances")
  .option("--instance <name>", "Named instance to target (from dotfile config)")
  .option("--url <baseUrl>", "Instance base URL (ad-hoc override, requires --key)")
  .option("--key <adminKey>", "Admin API key (ad-hoc override, requires --url)")
  .option("--json", "Output machine-readable JSON")

program.addCommand(makeConfigCommand())
program.addCommand(makeLoginCommand())
program.addCommand(makeHealthCommand())
program.addCommand(makeLogsCommand())
program.addCommand(makeMcpCommand())

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
  program.parseAsync(process.argv).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}

export { program }
