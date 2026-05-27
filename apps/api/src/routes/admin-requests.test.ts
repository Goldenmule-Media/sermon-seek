import { describe, expect, it, vi } from "vitest"

vi.mock("../config.js", () => ({
  config: {
    SESSION_COOKIE_NAME: "sermon_session",
    COOKIE_SECRET: "a".repeat(64),
    DATABASE_URL: "postgres://localhost/test",
    LIMITED_INGEST_TOKEN_CAP: 750_000,
    WEB_BASE_URL: "http://localhost:3000",
  },
}))

vi.mock("@sermon-search/notifications", () => ({
  loadConfigFromEnv: () => ({ from: "no-reply@test.com" }),
  createEmailSender: () => ({ send: async () => {} }),
  notify: async () => ({ recipients: [] }),
}))

describe("list querystring schema", async () => {
  const { z } = await import("zod")
  const schema = z.object({
    status: z
      .enum([
        "received",
        "running",
        "awaiting_approval",
        "approved",
        "denied",
        "failed",
        "complete",
      ])
      .optional(),
    user_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })

  it("applies defaults when empty", () => {
    const result = schema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(20)
      expect(result.data.offset).toBe(0)
      expect(result.data.status).toBeUndefined()
      expect(result.data.user_id).toBeUndefined()
    }
  })

  it("accepts a valid status enum value", () => {
    const result = schema.safeParse({ status: "awaiting_approval" })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.status).toBe("awaiting_approval")
  })

  it("rejects an invalid status value", () => {
    const result = schema.safeParse({ status: "unknown_status" })
    expect(result.success).toBe(false)
  })

  it("accepts all valid status enum values", () => {
    const validStatuses = [
      "received",
      "running",
      "awaiting_approval",
      "approved",
      "denied",
      "failed",
      "complete",
    ]
    for (const status of validStatuses) {
      const result = schema.safeParse({ status })
      expect(result.success).toBe(true)
    }
  })

  it("accepts a valid uuid for user_id", () => {
    const result = schema.safeParse({ user_id: "00000000-0000-0000-0000-000000000001" })
    expect(result.success).toBe(true)
  })

  it("rejects a non-uuid user_id", () => {
    const result = schema.safeParse({ user_id: "not-a-uuid" })
    expect(result.success).toBe(false)
  })

  it("rejects limit > 100", () => {
    const result = schema.safeParse({ limit: 101 })
    expect(result.success).toBe(false)
  })

  it("rejects limit < 1", () => {
    const result = schema.safeParse({ limit: 0 })
    expect(result.success).toBe(false)
  })

  it("rejects negative offset", () => {
    const result = schema.safeParse({ offset: -1 })
    expect(result.success).toBe(false)
  })

  it("coerces string limit to number", () => {
    const result = schema.safeParse({ limit: "50" })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.limit).toBe(50)
  })
})

describe("deny body schema", async () => {
  const { z } = await import("zod")
  const schema = z.object({
    note: z.string().min(1).max(500),
  })

  it("accepts a valid note", () => {
    const result = schema.safeParse({ note: "Channel is spam" })
    expect(result.success).toBe(true)
  })

  it("rejects an empty note", () => {
    const result = schema.safeParse({ note: "" })
    expect(result.success).toBe(false)
  })

  it("rejects a note longer than 500 chars", () => {
    const result = schema.safeParse({ note: "a".repeat(501) })
    expect(result.success).toBe(false)
  })

  it("accepts a note exactly 500 chars", () => {
    const result = schema.safeParse({ note: "a".repeat(500) })
    expect(result.success).toBe(true)
  })

  it("rejects missing note", () => {
    const result = schema.safeParse({})
    expect(result.success).toBe(false)
  })
})
