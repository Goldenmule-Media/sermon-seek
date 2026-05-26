import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

vi.mock("../config.js", () => ({
  config: {
    SESSION_COOKIE_NAME: "sermon_session",
    STATE_COOKIE_NAME: "sermon_oauth_state",
    COOKIE_SECRET: "a".repeat(32),
    COOKIE_SECURE: false,
  },
}))

const { hashToken, mintToken } = await import("./session.js")

describe("hashToken", () => {
  it("produces the same sha256 hex for the same input", () => {
    const token = "abc123"
    const expected = createHash("sha256").update(token).digest("hex")
    expect(hashToken(token)).toBe(expected)
    expect(hashToken(token)).toBe(hashToken(token))
  })

  it("produces different hashes for different inputs", () => {
    expect(hashToken("aaa")).not.toBe(hashToken("bbb"))
  })
})

describe("mintToken", () => {
  it("returns a 64-char hex string (32 bytes)", () => {
    const token = mintToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it("returns a different token each call", () => {
    expect(mintToken()).not.toBe(mintToken())
  })
})
