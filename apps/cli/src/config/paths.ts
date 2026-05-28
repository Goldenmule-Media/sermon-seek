import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

function primaryPath(): string {
  const override = process.env.SERMON_ADMIN_CONFIG
  if (override) return override

  const xdg = process.env.XDG_CONFIG_HOME
  const base = xdg ? xdg : join(homedir(), ".config")
  return join(base, "sermon-search", "config.json")
}

function legacyPath(): string {
  return join(homedir(), ".sermon-search.json")
}

export function resolveReadPath(): string {
  const primary = primaryPath()
  if (existsSync(primary)) return primary

  const legacy = legacyPath()
  if (existsSync(legacy)) return legacy

  return primary
}

export function resolveWritePath(): string {
  return primaryPath()
}
