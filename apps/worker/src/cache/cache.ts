import * as fsp from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"

function resolveRoot(): string {
  const fromEnv = process.env.CACHE_DIR
  const raw = fromEnv && fromEnv.length > 0 ? fromEnv : "./.cache"
  return resolve(process.cwd(), raw)
}

const ROOT = resolveRoot()

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err
}

function validateParts(parts: string[]): void {
  if (parts.length === 0) {
    throw new Error("cache.path: parts must not be empty")
  }
  for (const part of parts) {
    if (typeof part !== "string" || part.length === 0) {
      throw new Error("cache.path: parts must be non-empty strings")
    }
    if (part === "." || part === "..") {
      throw new Error(`cache.path: invalid segment ${JSON.stringify(part)}`)
    }
    if (part.includes("/") || part.includes("\\") || part.includes(sep)) {
      throw new Error(
        `cache.path: segment must not contain path separators: ${JSON.stringify(part)}`,
      )
    }
    if (part.includes("\0")) {
      throw new Error("cache.path: segment must not contain NUL bytes")
    }
  }
}

function path(parts: string[]): string {
  validateParts(parts)
  return join(ROOT, ...parts)
}

async function exists(parts: string[]): Promise<boolean> {
  try {
    await fsp.stat(path(parts))
    return true
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") return false
    throw err
  }
}

async function readText(parts: string[]): Promise<string | null> {
  try {
    return await fsp.readFile(path(parts), "utf8")
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") return null
    throw err
  }
}

async function readJson<T>(parts: string[]): Promise<T | null> {
  const text = await readText(parts)
  if (text === null) return null
  return JSON.parse(text) as T
}

async function writeTextAtomic(parts: string[], value: string): Promise<void> {
  const target = path(parts)
  const tmp = `${target}.tmp`
  await fsp.mkdir(dirname(target), { recursive: true })
  await fsp.writeFile(tmp, value, "utf8")
  try {
    await fsp.rename(tmp, target)
  } catch (err) {
    try {
      await fsp.unlink(tmp)
    } catch {
      // best-effort cleanup
    }
    throw err
  }
}

async function writeJsonAtomic(parts: string[], value: unknown): Promise<void> {
  await writeTextAtomic(parts, `${JSON.stringify(value, null, 2)}\n`)
}

async function unlink(parts: string[]): Promise<void> {
  try {
    await fsp.unlink(path(parts))
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") return
    throw err
  }
}

async function mergePrependedItems<T>(
  parts: string[],
  newItems: readonly T[],
  idKey: keyof T,
): Promise<void> {
  const existing = (await readJson<T[]>(parts)) ?? []
  const existingIds = new Set<unknown>()
  for (const item of existing) {
    existingIds.add(item[idKey])
  }

  const prepend: T[] = []
  for (const item of newItems) {
    const id = item[idKey]
    if (existingIds.has(id)) break
    prepend.push(item)
  }

  if (prepend.length === 0) return

  await writeJsonAtomic(parts, [...prepend, ...existing])
}

export const cache = {
  path,
  exists,
  readText,
  readJson,
  writeTextAtomic,
  writeJsonAtomic,
  unlink,
  mergePrependedItems,
}

export type Cache = typeof cache
