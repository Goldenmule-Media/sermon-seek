import { spawn as nodeSpawn } from "node:child_process"
import * as fsp from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cache } from "../cache/cache.js"
import { CaptionsUnavailable, YtDlpFailed } from "./errors.js"

const STDERR_TAIL_LIMIT = 4096

export interface SpawnResult {
  exitCode: number | null
  stderr: string
}

export type Spawner = (args: {
  command: string
  args: string[]
  cwd: string
}) => Promise<SpawnResult>

export interface FetchCaptionsOptions {
  videoId: string
  spawner?: Spawner
  ytDlpBin?: string
}

export interface FetchCaptionsResult {
  vttPath: string
  fromCache: boolean
}

const defaultSpawner: Spawner = ({ command, args, cwd }) =>
  new Promise<SpawnResult>((resolve, reject) => {
    const child = nodeSpawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stderr = ""
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < STDERR_TAIL_LIMIT) {
        stderr = (stderr + chunk).slice(-STDERR_TAIL_LIMIT)
      }
    })
    child.stdout.resume()
    child.on("error", (err) => reject(err))
    child.on("close", (exitCode) => resolve({ exitCode, stderr }))
  })

function isVideoIdSafe(id: string): boolean {
  return /^[A-Za-z0-9_-]{6,32}$/.test(id)
}

export async function fetchCaptions(opts: FetchCaptionsOptions): Promise<FetchCaptionsResult> {
  const { videoId } = opts
  const spawner = opts.spawner ?? defaultSpawner
  const ytDlpBin = opts.ytDlpBin ?? "yt-dlp"

  if (!isVideoIdSafe(videoId)) {
    throw new YtDlpFailed(
      null,
      `Refusing to fetch with unsafe video id: ${JSON.stringify(videoId)}`,
    )
  }

  const parts = ["videos", videoId, "captions.vtt"]
  if (await cache.exists(parts)) {
    return { vttPath: cache.path(parts), fromCache: true }
  }

  const workDir = await fsp.mkdtemp(join(tmpdir(), `sermon-captions-${videoId}-`))
  try {
    // Keep `youtube:player_client=android`: it avoids needing a JS runtime in
    // the worker image. The default (web) client now requires deno/Node to
    // solve the player challenge, which the image doesn't ship. Verified
    // against yt-dlp 2026.3.17 — see apps/worker/src/captions/version.ts.
    const args = [
      "--skip-download",
      "--write-auto-subs",
      "--sub-format",
      "vtt",
      "--sub-langs",
      "en",
      "--extractor-args",
      "youtube:player_client=android",
      "-o",
      "%(id)s.%(ext)s",
      "--",
      videoId,
    ]

    let result: SpawnResult
    try {
      result = await spawner({ command: ytDlpBin, args, cwd: workDir })
    } catch (err) {
      throw new YtDlpFailed(null, err instanceof Error ? err.message : String(err), { cause: err })
    }

    if (result.exitCode !== 0) {
      throw new YtDlpFailed(result.exitCode, result.stderr)
    }

    const candidates = [`${videoId}.en.vtt`, `${videoId}.en-orig.vtt`]
    let producedPath: string | null = null
    for (const name of candidates) {
      const p = join(workDir, name)
      try {
        await fsp.stat(p)
        producedPath = p
        break
      } catch {
        // try next candidate
      }
    }

    if (producedPath === null) {
      throw new CaptionsUnavailable(videoId)
    }

    const raw = await fsp.readFile(producedPath, "utf8")
    await cache.writeTextAtomic(parts, raw)

    return { vttPath: cache.path(parts), fromCache: false }
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {
      // best-effort cleanup
    })
  }
}
