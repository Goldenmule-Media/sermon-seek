import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const renameControl = vi.hoisted(() => {
  let pendingFailure: Error | null = null
  return {
    failOnce(err: Error) {
      pendingFailure = err
    },
    take(): Error | null {
      const err = pendingFailure
      pendingFailure = null
      return err
    },
  }
})

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
  return {
    ...actual,
    default: actual,
    rename: async (
      src: Parameters<typeof actual.rename>[0],
      dst: Parameters<typeof actual.rename>[1],
    ) => {
      const err = renameControl.take()
      if (err) throw err
      return actual.rename(src, dst)
    },
  }
})

type CacheModule = typeof import("./cache.js")

let tmpRoot: string
let mod: CacheModule

async function loadCache(root: string): Promise<CacheModule> {
  process.env.CACHE_DIR = root
  vi.resetModules()
  return (await import("./cache.js")) as CacheModule
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "sermon-cache-"))
  mod = await loadCache(tmpRoot)
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

describe("cache.path", () => {
  it("resolves under $CACHE_DIR with the spec's layout", () => {
    const p = mod.cache.path(["videos", "abc", "metadata.json"])
    expect(p).toBe(join(tmpRoot, "videos", "abc", "metadata.json"))
  })

  it("rejects empty and traversal segments", () => {
    expect(() => mod.cache.path([])).toThrow()
    expect(() => mod.cache.path([""])).toThrow()
    expect(() => mod.cache.path(["..", "etc"])).toThrow()
    expect(() => mod.cache.path(["a/b"])).toThrow()
  })
})

describe("writeJsonAtomic / readJson", () => {
  it("round-trips JSON under the layout", async () => {
    await mod.cache.writeJsonAtomic(["channels", "UC123", "metadata.json"], { id: "UC123" })
    const read = await mod.cache.readJson<{ id: string }>(["channels", "UC123", "metadata.json"])
    expect(read).toEqual({ id: "UC123" })
  })

  it("returns null on missing JSON (ENOENT)", async () => {
    const read = await mod.cache.readJson(["videos", "missing", "metadata.json"])
    expect(read).toBeNull()
  })

  it("never exposes a partially written file on rename failure", async () => {
    const parts = ["videos", "vid1", "metadata.json"]
    // Seed prior content so we can verify it's preserved.
    await mod.cache.writeJsonAtomic(parts, { v: 1 })

    renameControl.failOnce(new Error("simulated crash"))

    await expect(mod.cache.writeJsonAtomic(parts, { v: 2 })).rejects.toThrow("simulated crash")

    // Reader sees the old value, not a half-written one.
    const after = await mod.cache.readJson<{ v: number }>(parts)
    expect(after).toEqual({ v: 1 })

    // No stray .tmp left in the dir.
    const dir = join(tmpRoot, "videos", "vid1")
    const entries = await readdir(dir)
    expect(entries).toEqual(["metadata.json"])
  })

  it("is idempotent: rewriting the same value yields the same final bytes", async () => {
    const parts = ["videos", "vid2", "metadata.json"]
    const value = { id: "vid2", title: "Hello" }
    await mod.cache.writeJsonAtomic(parts, value)
    const first = await readFile(join(tmpRoot, ...parts))
    await mod.cache.writeJsonAtomic(parts, value)
    const second = await readFile(join(tmpRoot, ...parts))
    expect(second.equals(first)).toBe(true)

    const dir = join(tmpRoot, "videos", "vid2")
    const entries = await readdir(dir)
    expect(entries).toEqual(["metadata.json"])
  })
})

describe("writeTextAtomic / readText", () => {
  it("round-trips raw text", async () => {
    const parts = ["videos", "vid3", "transcript.vtt"]
    await mod.cache.writeTextAtomic(parts, "WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n")
    const text = await mod.cache.readText(parts)
    expect(text).toBe("WEBVTT\n\n00:00.000 --> 00:01.000\nhi\n")
  })

  it("returns null on missing text", async () => {
    expect(await mod.cache.readText(["videos", "nope", "transcript.vtt"])).toBeNull()
  })
})

describe("exists / unlink", () => {
  it("reports existence and tolerates ENOENT on unlink", async () => {
    const parts = ["videos", "vid4", "metadata.json"]
    expect(await mod.cache.exists(parts)).toBe(false)
    await mod.cache.writeJsonAtomic(parts, {})
    expect(await mod.cache.exists(parts)).toBe(true)
    await mod.cache.unlink(parts)
    expect(await mod.cache.exists(parts)).toBe(false)
    // Second unlink is a no-op.
    await expect(mod.cache.unlink(parts)).resolves.toBeUndefined()
  })
})

describe("mergePrependedItems", () => {
  const parts = ["channels", "UCX", "uploads.json"]

  it("writes all items when cache is empty", async () => {
    await mod.cache.mergePrependedItems(parts, [{ id: "a" }, { id: "b" }], "id")
    const read = await mod.cache.readJson<{ id: string }[]>(parts)
    expect(read).toEqual([{ id: "a" }, { id: "b" }])
  })

  it("stops at the first known ID and only prepends new ones above it", async () => {
    await mod.cache.writeJsonAtomic(parts, [{ id: "c" }, { id: "b" }, { id: "a" }])
    await mod.cache.mergePrependedItems(
      parts,
      [{ id: "e" }, { id: "d" }, { id: "b" }, { id: "z" }],
      "id",
    )
    const read = await mod.cache.readJson<{ id: string }[]>(parts)
    expect(read).toEqual([{ id: "e" }, { id: "d" }, { id: "c" }, { id: "b" }, { id: "a" }])
  })

  it("does not rewrite the file when no new items are above a known ID", async () => {
    await mod.cache.writeJsonAtomic(parts, [{ id: "c" }, { id: "b" }, { id: "a" }])
    const fullPath = join(tmpRoot, ...parts)
    const before = await readFile(fullPath)
    await mod.cache.mergePrependedItems(parts, [{ id: "c" }, { id: "b" }], "id")
    const after = await readFile(fullPath)
    expect(after.equals(before)).toBe(true)
  })

  it("does nothing when newItems is empty and cache is missing", async () => {
    await mod.cache.mergePrependedItems(parts, [], "id")
    expect(await mod.cache.exists(parts)).toBe(false)
  })
})

describe("module wiring", () => {
  it("re-exports cache from the package barrel", async () => {
    const barrel = (await import("./index.js")) as typeof import("./index.js")
    expect(barrel.cache).toBe(mod.cache)
  })

  it("falls back to ./.cache when $CACHE_DIR is unset", async () => {
    // biome-ignore lint/performance/noDelete: assigning undefined would coerce to the string "undefined".
    delete process.env.CACHE_DIR
    vi.resetModules()
    const fresh = (await import("./cache.js")) as CacheModule
    const p = fresh.cache.path(["videos", "x", "metadata.json"])
    expect(p).toBe(join(process.cwd(), ".cache", "videos", "x", "metadata.json"))
  })
})
