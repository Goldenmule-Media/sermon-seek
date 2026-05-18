import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Spawner } from "./fetch.js"

type FetchModule = typeof import("./fetch.js")
type CacheModule = typeof import("../cache/cache.js")
type ErrorsModule = typeof import("./errors.js")

let tmpRoot: string
let fetchMod: FetchModule
let cacheMod: CacheModule
let errorsMod: ErrorsModule

async function loadModules(root: string) {
  process.env.CACHE_DIR = root
  vi.resetModules()
  cacheMod = (await import("../cache/cache.js")) as CacheModule
  errorsMod = (await import("./errors.js")) as ErrorsModule
  fetchMod = (await import("./fetch.js")) as FetchModule
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "sermon-fetch-"))
  await loadModules(tmpRoot)
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

const VIDEO_ID = "abc123XYZ_-"
const SAMPLE_VTT = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhello\n"

describe("fetchCaptions", () => {
  it("short-circuits on cache hit without invoking the spawner", async () => {
    await cacheMod.cache.writeTextAtomic(["videos", VIDEO_ID, "captions.vtt"], SAMPLE_VTT)
    const spawner = vi.fn<Spawner>()

    const result = await fetchMod.fetchCaptions({ videoId: VIDEO_ID, spawner })

    expect(result.fromCache).toBe(true)
    expect(result.vttPath).toBe(cacheMod.cache.path(["videos", VIDEO_ID, "captions.vtt"]))
    expect(spawner).not.toHaveBeenCalled()
  })

  it("happy path: spawns yt-dlp, atomically writes result to cache, cleans tmpdir", async () => {
    let observedCwd = ""
    const spawner: Spawner = async ({ args, cwd }) => {
      observedCwd = cwd
      // Mimic yt-dlp -o '%(id)s.%(ext)s' producing <id>.en.vtt in cwd.
      expect(args).toContain("--skip-download")
      expect(args).toContain("--write-auto-subs")
      expect(args).toContain("en")
      await writeFile(join(cwd, `${VIDEO_ID}.en.vtt`), SAMPLE_VTT, "utf8")
      return { exitCode: 0, stderr: "" }
    }

    const result = await fetchMod.fetchCaptions({ videoId: VIDEO_ID, spawner })

    expect(result.fromCache).toBe(false)
    const cached = await readFile(cacheMod.cache.path(["videos", VIDEO_ID, "captions.vtt"]), "utf8")
    expect(cached).toBe(SAMPLE_VTT)

    // tmpdir was cleaned up.
    await expect(readFile(join(observedCwd, `${VIDEO_ID}.en.vtt`), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it("falls back to .en-orig.vtt when .en.vtt is absent", async () => {
    const spawner: Spawner = async ({ cwd }) => {
      await writeFile(join(cwd, `${VIDEO_ID}.en-orig.vtt`), SAMPLE_VTT, "utf8")
      return { exitCode: 0, stderr: "" }
    }
    const result = await fetchMod.fetchCaptions({ videoId: VIDEO_ID, spawner })
    expect(result.fromCache).toBe(false)
    const cached = await readFile(cacheMod.cache.path(["videos", VIDEO_ID, "captions.vtt"]), "utf8")
    expect(cached).toBe(SAMPLE_VTT)
  })

  it("throws YtDlpFailed when yt-dlp exits non-zero, carrying exit code + stderr tail", async () => {
    let observedCwd = ""
    const spawner: Spawner = async ({ cwd }) => {
      observedCwd = cwd
      return { exitCode: 2, stderr: "ERROR: video unavailable\n" }
    }

    await expect(fetchMod.fetchCaptions({ videoId: VIDEO_ID, spawner })).rejects.toMatchObject({
      name: "YtDlpFailed",
      exitCode: 2,
      stderrTail: expect.stringContaining("video unavailable"),
    })
    await expect(fetchMod.fetchCaptions({ videoId: VIDEO_ID, spawner })).rejects.toBeInstanceOf(
      errorsMod.YtDlpFailed,
    )

    // tmpdir was cleaned up on failure.
    await expect(readFile(join(observedCwd, "anything"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it("throws CaptionsUnavailable when yt-dlp succeeds but produces no VTT", async () => {
    const spawner: Spawner = async () => ({ exitCode: 0, stderr: "" })
    await expect(fetchMod.fetchCaptions({ videoId: VIDEO_ID, spawner })).rejects.toBeInstanceOf(
      errorsMod.CaptionsUnavailable,
    )
    expect(await cacheMod.cache.exists(["videos", VIDEO_ID, "captions.vtt"])).toBe(false)
  })

  it("rejects unsafe video ids before spawning", async () => {
    const spawner = vi.fn<Spawner>()
    await expect(
      fetchMod.fetchCaptions({ videoId: "../etc/passwd", spawner }),
    ).rejects.toBeInstanceOf(errorsMod.YtDlpFailed)
    expect(spawner).not.toHaveBeenCalled()
  })
})
