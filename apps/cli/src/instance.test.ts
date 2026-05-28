import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { saveConfig, setInstance } from "./config/store.js"
import { resolveInstance } from "./instance.js"

describe("resolveInstance precedence", () => {
  let dir: string
  let origEnv: Record<string, string | undefined>

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cli-inst-test-"))
    origEnv = {
      SERMON_ADMIN_CONFIG: process.env.SERMON_ADMIN_CONFIG,
      SERMON_ADMIN_URL: process.env.SERMON_ADMIN_URL,
      SERMON_ADMIN_KEY: process.env.SERMON_ADMIN_KEY,
    }
    process.env.SERMON_ADMIN_CONFIG = join(dir, "config.json")
    Reflect.deleteProperty(process.env, "SERMON_ADMIN_URL")
    Reflect.deleteProperty(process.env, "SERMON_ADMIN_KEY")
  })

  afterEach(async () => {
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await rm(dir, { recursive: true })
  })

  it("--url + --key takes highest precedence", () => {
    const inst = resolveInstance({ url: "http://explicit:3001", key: "explicit-key" })
    expect(inst.name).toBe("(flags)")
    expect(inst.baseUrl).toBe("http://explicit:3001")
    expect(inst.adminKey).toBe("explicit-key")
  })

  it("throws if only --url is given", () => {
    expect(() => resolveInstance({ url: "http://only-url:3001" })).toThrow(
      /Both --url and --key must be provided together/,
    )
  })

  it("--instance resolves from config", async () => {
    const cfg = setInstance({ instances: {} }, "staging", {
      baseUrl: "http://staging:3001",
      adminKey: "staging-key",
    })
    await saveConfig(cfg)
    const inst = resolveInstance({ instance: "staging" })
    expect(inst.name).toBe("staging")
    expect(inst.baseUrl).toBe("http://staging:3001")
  })

  it("--instance throws for unknown name", async () => {
    await saveConfig({ instances: {} })
    expect(() => resolveInstance({ instance: "ghost" })).toThrow(/Unknown instance "ghost"/)
  })

  it("env vars (SERMON_ADMIN_URL + SERMON_ADMIN_KEY) take precedence over config", async () => {
    const cfg = setInstance({ instances: {} }, "local", {
      baseUrl: "http://localhost:3001",
      adminKey: "local-key",
    })
    await saveConfig(cfg)
    process.env.SERMON_ADMIN_URL = "http://env-url:3001"
    process.env.SERMON_ADMIN_KEY = "env-key"
    const inst = resolveInstance({})
    expect(inst.name).toBe("(env)")
    expect(inst.baseUrl).toBe("http://env-url:3001")
    expect(inst.adminKey).toBe("env-key")
  })

  it("throws if only SERMON_ADMIN_URL is set", () => {
    process.env.SERMON_ADMIN_URL = "http://partial:3001"
    expect(() => resolveInstance({})).toThrow(/Both SERMON_ADMIN_URL and SERMON_ADMIN_KEY/)
  })

  it("falls back to currentInstance in config", async () => {
    let cfg = setInstance({ instances: {} }, "prod", {
      baseUrl: "https://api.example.com",
      adminKey: "prod-key",
    })
    cfg = { ...cfg, currentInstance: "prod" }
    await saveConfig(cfg)
    const inst = resolveInstance({})
    expect(inst.name).toBe("prod")
    expect(inst.adminKey).toBe("prod-key")
  })

  it("throws when nothing is configured", async () => {
    await saveConfig({ instances: {} })
    expect(() => resolveInstance({})).toThrow(/No instance configured/)
  })
})
