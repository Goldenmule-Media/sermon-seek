import { loadConfig } from "./config/store.js"

export interface ResolvedInstance {
  name: string
  baseUrl: string
  adminKey: string
}

export interface InstanceFlags {
  instance?: string | undefined
  url?: string | undefined
  key?: string | undefined
}

export function resolveInstance(flags: InstanceFlags): ResolvedInstance {
  // 1. Explicit --url + --key flags
  if (flags.url && flags.key) {
    return { name: "(flags)", baseUrl: flags.url, adminKey: flags.key }
  }
  if (flags.url || flags.key) {
    throw new Error("Both --url and --key must be provided together.")
  }

  // 2. --instance flag → config lookup
  if (flags.instance) {
    const cfg = loadConfig()
    const inst = cfg.instances[flags.instance]
    if (!inst) {
      throw new Error(
        `Unknown instance "${flags.instance}". Run \`sermon-admin config list\` to see available instances.`,
      )
    }
    return { name: flags.instance, baseUrl: inst.baseUrl, adminKey: inst.adminKey }
  }

  // 3. SERMON_ADMIN_URL + SERMON_ADMIN_KEY env vars
  const envUrl = process.env.SERMON_ADMIN_URL
  const envKey = process.env.SERMON_ADMIN_KEY
  if (envUrl && envKey) {
    return { name: "(env)", baseUrl: envUrl, adminKey: envKey }
  }
  if (envUrl || envKey) {
    throw new Error("Both SERMON_ADMIN_URL and SERMON_ADMIN_KEY must be set together.")
  }

  // 4. currentInstance from dotfile
  const cfg = loadConfig()
  const currentName = cfg.currentInstance
  if (currentName) {
    const inst = cfg.instances[currentName]
    if (!inst) {
      throw new Error(
        `Current instance "${currentName}" not found in config. Run \`sermon-admin config list\`.`,
      )
    }
    return { name: currentName, baseUrl: inst.baseUrl, adminKey: inst.adminKey }
  }

  throw new Error(
    "No instance configured. Run `sermon-admin login` or `sermon-admin config set-instance`.",
  )
}
