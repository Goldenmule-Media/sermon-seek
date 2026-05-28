import { Command } from "commander"
import { loadConfig, redactKey, saveConfig, setInstance, useInstance } from "../config/store.js"

export function makeConfigCommand(): Command {
  const cmd = new Command("config").description("Manage CLI instance configuration")

  cmd
    .command("set-instance <name>")
    .description("Add or update a named instance")
    .requiredOption("--url <baseUrl>", "Base URL of the Sermon-Search API instance")
    .requiredOption("--key <adminKey>", "Admin API key for the instance")
    .action(async (name: string, opts: { url: string; key: string }) => {
      let cfg = loadConfig()
      cfg = setInstance(cfg, name, { baseUrl: opts.url, adminKey: opts.key })
      await saveConfig(cfg)
      console.log(`Instance "${name}" saved (${opts.url}).`)
      if (cfg.currentInstance === name) {
        console.log(`Now using "${name}" as the current instance.`)
      }
    })

  cmd
    .command("use <name>")
    .description("Switch the active instance")
    .action(async (name: string) => {
      let cfg = loadConfig()
      cfg = useInstance(cfg, name)
      await saveConfig(cfg)
      console.log(`Switched to instance "${name}".`)
    })

  cmd
    .command("show [name]")
    .description("Show configuration for an instance (key is redacted)")
    .action((name: string | undefined) => {
      const cfg = loadConfig()
      const instanceName = name ?? cfg.currentInstance
      if (!instanceName) {
        console.error("No current instance set. Pass a name or run `login` first.")
        process.exit(1)
      }
      const inst = cfg.instances[instanceName]
      if (!inst) {
        console.error(`Unknown instance "${instanceName}". Run \`config list\` to see instances.`)
        process.exit(1)
      }
      const isCurrent = instanceName === cfg.currentInstance
      console.log(`Instance: ${instanceName}${isCurrent ? " (current)" : ""}`)
      console.log(`  baseUrl:  ${inst.baseUrl}`)
      console.log(`  adminKey: ${redactKey(inst.adminKey)}`)
    })

  cmd
    .command("list")
    .description("List all configured instances")
    .action(() => {
      const cfg = loadConfig()
      const names = Object.keys(cfg.instances)
      if (names.length === 0) {
        console.log("No instances configured. Run `login` or `config set-instance` to add one.")
        return
      }
      for (const name of names) {
        const marker = name === cfg.currentInstance ? "* " : "  "
        const url = cfg.instances[name]?.baseUrl ?? ""
        console.log(`${marker}${name}  ${url}`)
      }
    })

  return cmd
}
