import { describe, expect, it, vi } from "vitest"

vi.mock("../config.js", () => ({
  config: {
    GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "test-secret",
    GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3001/v1/auth/google/callback",
    COOKIE_SECRET: "a".repeat(32),
    SESSION_COOKIE_NAME: "sermon_session",
    STATE_COOKIE_NAME: "sermon_oauth_state",
    WEB_BASE_URL: "http://localhost:3000",
    COOKIE_SECURE: false,
  },
}))

const { requireCsrfHeader } = await import("./auth.js")

type Req = Parameters<typeof requireCsrfHeader>[0]
type Reply = Parameters<typeof requireCsrfHeader>[1]

function makeReply() {
  const reply = {
    sentCode: 0,
    sentBody: undefined as unknown,
    code(n: number) {
      this.sentCode = n
      return {
        send: async (b: unknown) => {
          reply.sentBody = b
        },
      }
    },
  }
  return reply
}

describe("requireCsrfHeader", () => {
  it("passes when x-sermon-csrf is '1'", async () => {
    const req = { headers: { "x-sermon-csrf": "1" } }
    const reply = makeReply()
    await requireCsrfHeader(req as unknown as Req, reply as unknown as Reply)
    expect(reply.sentCode).toBe(0)
  })

  it("returns 400 when x-sermon-csrf is missing", async () => {
    const req = { headers: {} }
    const reply = makeReply()
    await requireCsrfHeader(req as unknown as Req, reply as unknown as Reply)
    expect(reply.sentCode).toBe(400)
    expect(reply.sentBody).toMatchObject({ error: "missing CSRF header" })
  })

  it("returns 400 when x-sermon-csrf is wrong value", async () => {
    const req = { headers: { "x-sermon-csrf": "true" } }
    const reply = makeReply()
    await requireCsrfHeader(req as unknown as Req, reply as unknown as Reply)
    expect(reply.sentCode).toBe(400)
  })
})
