import { chmodSync, readFileSync, writeFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { resolveReadPath, resolveWritePath } from "./paths.js"
import { type CliConfig, type InstanceConfig, cliConfigSchema, defaultConfig } from "./schema.js"

export function loadConfig(): CliConfig {
  const path = resolveReadPath()
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, "utf8"))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...defaultConfig, instances: {} }
    throw new Error(
      `Failed to read config at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const result = cliConfigSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Malformed config at ${path}: ${result.error.message}`)
  }
  return result.data
}

export async function saveConfig(cfg: CliConfig): Promise<void> {
  const path = resolveWritePath()
  await mkdir(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

export function setInstance(cfg: CliConfig, name: string, instance: InstanceConfig): CliConfig {
  return {
    ...cfg,
    currentInstance: cfg.currentInstance ?? name,
    instances: { ...cfg.instances, [name]: instance },
  }
}

export function useInstance(cfg: CliConfig, name: string): CliConfig {
  if (!cfg.instances[name]) {
    throw new Error(`Unknown instance "${name}". Run \`config list\` to see available instances.`)
  }
  return { ...cfg, currentInstance: name }
}

export function redactKey(key: string): string {
  if (key.length <= 4) return "••••"
  return `••••••••${key.slice(-4)}`
}
