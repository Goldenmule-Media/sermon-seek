import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveReadPath, resolveWritePath } from "./paths.js"
import { loadConfig, redactKey, saveConfig, setInstance, useInstance } from "./store.js"

describe("resolveReadPath / resolveWritePath", () => {
  let origEnv: Record<string, string | undefined>

  beforeEach(() => {
    origEnv = {
      SERMON_ADMIN_CONFIG: process.env.SERMON_ADMIN_CONFIG,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    }
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it("SERMON_ADMIN_CONFIG overrides everything", () => {
    process.env.SERMON_ADMIN_CONFIG = "/custom/path/config.json"
    Reflect.deleteProperty(process.env, "XDG_CONFIG_HOME")
    expect(resolveWritePath()).toBe("/custom/path/config.json")
    expect(resolveReadPath()).toBe("/custom/path/config.json")
  })

  it("XDG_CONFIG_HOME shapes the primary path", () => {
    Reflect.deleteProperty(process.env, "SERMON_ADMIN_CONFIG")
    process.env.XDG_CONFIG_HOME = "/xdg/config"
    expect(resolveWritePath()).toBe("/xdg/config/sermon-search/config.json")
  })

  it("falls back to ~/.config when no XDG_CONFIG_HOME", () => {
    Reflect.deleteProperty(process.env, "SERMON_ADMIN_CONFIG")
    Reflect.deleteProperty(process.env, "XDG_CONFIG_HOME")
    expect(resolveWritePath()).toBe(join(homedir(), ".config", "sermon-search", "config.json"))
  })

  it("resolveReadPath returns primary when it exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cli-test-"))
    try {
      process.env.SERMON_ADMIN_CONFIG = join(dir, "config.json")
      writeFileSync(process.env.SERMON_ADMIN_CONFIG, "{}")
      expect(resolveReadPath()).toBe(process.env.SERMON_ADMIN_CONFIG)
    } finally {
      await rm(dir, { recursive: true })
    }
  })
})

describe("loadConfig / saveConfig round-trip", () => {
  let dir: string
  let origEnv: Record<string, string | undefined>

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cli-test-"))
    origEnv = { SERMON_ADMIN_CONFIG: process.env.SERMON_ADMIN_CONFIG }
    process.env.SERMON_ADMIN_CONFIG = join(dir, "config.json")
  })

  afterEach(async () => {
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await rm(dir, { recursive: true })
  })

  it("returns default when file is absent", () => {
    const cfg = loadConfig()
    expect(cfg.instances).toEqual({})
    expect(cfg.currentInstance).toBeUndefined()
  })

  it("round-trips through save/load", async () => {
    const cfg = setInstance({ instances: {} }, "local", {
      baseUrl: "http://localhost:3001",
      adminKey: "supersecret",
    })
    await saveConfig(cfg)
    const loaded = loadConfig()
    expect(loaded.currentInstance).toBe("local")
    expect(loaded.instances.local?.baseUrl).toBe("http://localhost:3001")
    expect(loaded.instances.local?.adminKey).toBe("supersecret")
  })

  it("writes file with mode 0600", async () => {
    await saveConfig({ instances: {} })
    const path = process.env.SERMON_ADMIN_CONFIG as string
    const mode = statSync(path).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it("sets mode 0600 even when file already existed with wider permissions", async () => {
    const path = process.env.SERMON_ADMIN_CONFIG as string
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, "{}", { mode: 0o644 })
    chmodSync(path, 0o644)
    await saveConfig({ instances: {} })
    const mode = statSync(path).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it("throws a clear error on malformed JSON", async () => {
    const path = process.env.SERMON_ADMIN_CONFIG as string
    await writeFile(path, "not json")
    expect(() => loadConfig()).toThrow(/Failed to read config/)
  })

  it("throws a clear error on schema violation", async () => {
    const path = process.env.SERMON_ADMIN_CONFIG as string
    await writeFile(path, JSON.stringify({ instances: { bad: { baseUrl: "not-a-url" } } }))
    expect(() => loadConfig()).toThrow(/Malformed config/)
  })
})

describe("setInstance / useInstance", () => {
  it("setInstance sets currentInstance when none was set", () => {
    const cfg = setInstance({ instances: {} }, "prod", {
      baseUrl: "https://api.example.com",
      adminKey: "key",
    })
    expect(cfg.currentInstance).toBe("prod")
  })

  it("setInstance does not overwrite an existing currentInstance", () => {
    const cfg = setInstance({ currentInstance: "local", instances: {} }, "prod", {
      baseUrl: "https://api.example.com",
      adminKey: "key",
    })
    expect(cfg.currentInstance).toBe("local")
  })

  it("useInstance updates currentInstance", () => {
    let cfg = setInstance({ instances: {} }, "local", {
      baseUrl: "http://localhost:3001",
      adminKey: "k",
    })
    cfg = setInstance(cfg, "prod", { baseUrl: "https://api.example.com", adminKey: "k2" })
    const switched = useInstance(cfg, "prod")
    expect(switched.currentInstance).toBe("prod")
  })

  it("useInstance throws for unknown instance", () => {
    expect(() => useInstance({ instances: {} }, "ghost")).toThrow(/Unknown instance/)
  })
})

describe("redactKey", () => {
  it("shows only the last 4 characters", () => {
    const redacted = redactKey("supersecretkey1234")
    expect(redacted).toBe("••••••••1234")
    expect(redacted).not.toContain("supersecret")
  })

  it("handles keys shorter than or equal to 4 chars", () => {
    expect(redactKey("ab")).toBe("••••")
    expect(redactKey("abcd")).toBe("••••")
  })

  it("never exposes the full key", () => {
    const key = "mysecretadminkey"
    expect(redactKey(key)).not.toContain(key)
  })
})
