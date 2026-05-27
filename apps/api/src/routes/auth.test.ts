import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../config.js", () => ({
  config: {
    GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "test-secret",
    GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3001/v1/auth/google/callback",
    COOKIE_SECRET: "a".repeat(32),
    SESSION_COOKIE_NAME: "sermon_session",
    STATE_COOKIE_NAME: "sermon_oauth_state",
    WEB_BASE_URL: "http://localhost:3000",
    ADMIN_BASE_URL: undefined as string | undefined,
    COOKIE_SECURE: false,
  },
}))

const { requireCsrfHeader, validateReturnTo } = await import("./auth.js")
const { config } = await import("../config.js")

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

describe("validateReturnTo", () => {
  afterEach(() => {
    config.ADMIN_BASE_URL = undefined
  })

  it("returns WEB_BASE_URL when value is undefined", () => {
    expect(validateReturnTo(undefined)).toBe("http://localhost:3000")
  })

  it("anchors a relative path to WEB_BASE_URL", () => {
    expect(validateReturnTo("/my-page")).toBe("http://localhost:3000/my-page")
  })

  it("accepts '/' as a valid relative path", () => {
    expect(validateReturnTo("/")).toBe("http://localhost:3000/")
  })

  it("accepts an absolute URL with the same origin as WEB_BASE_URL", () => {
    expect(validateReturnTo("http://localhost:3000/some/path")).toBe(
      "http://localhost:3000/some/path",
    )
  })

  it("rejects a cross-origin URL and falls back to WEB_BASE_URL", () => {
    expect(validateReturnTo("https://evil.example.com/steal")).toBe("http://localhost:3000")
  })

  it("accepts an absolute URL matching ADMIN_BASE_URL origin when set", () => {
    config.ADMIN_BASE_URL = "http://localhost:3002"
    expect(validateReturnTo("http://localhost:3002/")).toBe("http://localhost:3002/")
  })

  it("rejects a URL that is neither WEB_BASE_URL nor ADMIN_BASE_URL", () => {
    config.ADMIN_BASE_URL = "http://localhost:3002"
    expect(validateReturnTo("http://localhost:4000/")).toBe("http://localhost:3000")
  })

  it("ADMIN_BASE_URL unset: web-origin URL still accepted", () => {
    config.ADMIN_BASE_URL = undefined
    expect(validateReturnTo("http://localhost:3000/x")).toBe("http://localhost:3000/x")
  })
})

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
