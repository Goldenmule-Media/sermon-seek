import type { Command } from "commander"
import { type AdminClient, createClient } from "../client.js"
import { resolveInstance } from "../instance.js"

interface GlobalOpts {
  instance?: string
  json?: boolean
  url?: string
  key?: string
}

export interface ResolvedClient {
  client: AdminClient
  json: boolean
}

export function resolveClient(cmd: Command): ResolvedClient {
  const globals = cmd.optsWithGlobals<GlobalOpts>()
  let instance: ReturnType<typeof resolveInstance>
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
  return { client: createClient(instance), json: globals.json ?? false }
}

export async function run<T>(
  cmd: Command,
  fn: (client: AdminClient, json: boolean) => Promise<T>,
): Promise<void> {
  const { client, json } = resolveClient(cmd)
  try {
    await fn(client, json)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
