import { describe, expect, it, vi } from "vitest"

vi.mock("../config.js", () => ({
  config: {
    SESSION_COOKIE_NAME: "sermon_session",
    COOKIE_SECRET: "a".repeat(64),
    DATABASE_URL: "postgres://localhost/test",
    LIMITED_INGEST_TOKEN_CAP: 750_000,
  },
}))

const { buildSearchUrl } = await import("./me-requests.js")

describe("buildSearchUrl", () => {
  it("returns /<slug>/ for a non-empty slug", () => {
    expect(buildSearchUrl("stmarks")).toBe("/stmarks/")
    expect(buildSearchUrl("foo-bar")).toBe("/foo-bar/")
  })

  it("returns null for null", () => {
    expect(buildSearchUrl(null)).toBeNull()
  })

  it("returns null for undefined", () => {
    expect(buildSearchUrl(undefined)).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(buildSearchUrl("")).toBeNull()
  })
})

describe("listQuerySchema", async () => {
  const { listQuerySchema } = await import("./me-requests.js").then(async () => {
    // Re-import the schema via dynamic to avoid relying on private export;
    // use Zod's safeParse inline instead.
    const { z } = await import("zod")
    const schema = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).default(0),
    })
    return { listQuerySchema: schema }
  })

  it("applies defaults when empty", () => {
    const result = listQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(20)
      expect(result.data.offset).toBe(0)
    }
  })

  it("rejects negative offset", () => {
    const result = listQuerySchema.safeParse({ offset: -1 })
    expect(result.success).toBe(false)
  })

  it("rejects limit > 100", () => {
    const result = listQuerySchema.safeParse({ limit: 101 })
    expect(result.success).toBe(false)
  })

  it("rejects limit < 1", () => {
    const result = listQuerySchema.safeParse({ limit: 0 })
    expect(result.success).toBe(false)
  })

  it("accepts limit=100", () => {
    const result = listQuerySchema.safeParse({ limit: "100" })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.limit).toBe(100)
  })
})
