import cookie from "@fastify/cookie"
import { createDb, migrateToLatest } from "@sermon-search/db"
import type { Database } from "@sermon-search/db"
import Fastify from "fastify"
import fp from "fastify-plugin"
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { GoogleIdTokenClaims, GoogleOAuthClient } from "../plugins/google-oauth.js"
import { hashToken, sessionPlugin } from "../plugins/session.js"
import { authRoutes } from "./auth.js"

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip

vi.mock("../config.js", () => ({
  config: {
    GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
    GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3001/v1/auth/google/callback",
    COOKIE_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    SESSION_COOKIE_NAME: "sermon_session",
    STATE_COOKIE_NAME: "sermon_oauth_state",
    WEB_BASE_URL: "http://localhost:3000",
    COOKIE_SECURE: false,
    SLUG_ALIAS_TTL_DAYS: 90,
  },
}))

const COOKIE_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const SESSION_COOKIE = "sermon_session"
const STATE_COOKIE = "sermon_oauth_state"

const STUB_CLAIMS: GoogleIdTokenClaims = {
  sub: "google-sub-abc123",
  name: "Test User",
  picture: "https://example.com/avatar.jpg",
  email: "test@example.com",
}

describeIfDb("auth integration", () => {
  let db: Kysely<Database>

  beforeAll(async () => {
    if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL")
    }
    await migrateToLatest(TEST_DATABASE_URL)
    db = createDb(TEST_DATABASE_URL)
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await sql`TRUNCATE sessions, users RESTART IDENTITY CASCADE`.execute(db)
  })

  async function buildApp(stubClaims = STUB_CLAIMS) {
    const stubOAuth: GoogleOAuthClient = {
      buildAuthorizeUrl({ state, codeChallenge, redirectUri }) {
        return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&code_challenge=${codeChallenge}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge_method=S256`
      },
      async exchangeCode() {
        return { idToken: "stub.id.token" }
      },
      async verifyIdToken() {
        return stubClaims
      },
    }

    const app = Fastify().withTypeProvider<ZodTypeProvider>()
    app.setValidatorCompiler(validatorCompiler)
    app.setSerializerCompiler(serializerCompiler)

    await app.register(cookie, { secret: COOKIE_SECRET })
    await app.register(fp(async (instance) => { instance.decorate("db", db) }, { name: "db" }))
    app.decorate("googleOAuth", stubOAuth)
    await app.register(sessionPlugin)
    await app.register(authRoutes)
    await app.ready()
    return app
  }

  it("full flow: /start → /callback → /me → logout → /me 401", async () => {
    const app = await buildApp()

    // 1. GET /auth/google/start
    const startRes = await app.inject({
      method: "GET",
      url: "/auth/google/start?return_to=/my-page",
    })
    expect(startRes.statusCode).toBe(302)
    const redirectTo = startRes.headers.location ?? ""
    expect(redirectTo).toMatch(/accounts\.google\.com/)
    expect(redirectTo).toContain("code_challenge_method=S256")

    // Extract state cookie
    const setCookieHeader = startRes.headers["set-cookie"]
    const rawStateCookieLine = Array.isArray(setCookieHeader)
      ? setCookieHeader.find((c) => c.startsWith(STATE_COOKIE))
      : setCookieHeader?.startsWith(STATE_COOKIE)
        ? setCookieHeader
        : undefined
    expect(rawStateCookieLine).toBeTruthy()

    // Extract the signed cookie value (everything between name= and ;)
    const stateCookieValue = rawStateCookieLine?.split(";")[0]?.split("=").slice(1).join("=")

    // Extract state from redirect URL
    const redirectUrl = new URL(redirectTo)
    const state = redirectUrl.searchParams.get("state") ?? ""
    expect(state).toBeTruthy()

    // 2. GET /auth/google/callback
    const callbackRes = await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=fake-code&state=${state}`,
      cookies: { [STATE_COOKIE]: stateCookieValue },
    })
    expect(callbackRes.statusCode).toBe(302)
    expect(callbackRes.headers.location).toBe("/my-page")

    // Session cookie set
    const sessionCookieHeader = callbackRes.headers["set-cookie"]
    const sessionCookieLine = Array.isArray(sessionCookieHeader)
      ? sessionCookieHeader.find((c) => c.startsWith(SESSION_COOKIE))
      : sessionCookieHeader?.startsWith(SESSION_COOKIE)
        ? sessionCookieHeader
        : undefined
    expect(sessionCookieLine).toBeTruthy()
    const sessionToken = sessionCookieLine?.split(";")[0]?.split("=").slice(1).join("=")

    // User and session created in DB
    const users = await db.selectFrom("users").selectAll().execute()
    expect(users).toHaveLength(1)
    expect(users[0]?.google_sub).toBe(STUB_CLAIMS.sub)
    expect(users[0]?.display_name).toBe(STUB_CLAIMS.name)

    const sessions = await db.selectFrom("sessions").selectAll().execute()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.session_token_hash).toBe(hashToken(sessionToken))

    // 3. GET /me with session cookie
    const meRes = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { [SESSION_COOKIE]: sessionToken },
    })
    expect(meRes.statusCode).toBe(200)
    const me = meRes.json()
    expect(me.id).toBe(users[0]?.id)
    expect(me.display_name).toBe(STUB_CLAIMS.name)
    expect(me.is_admin).toBe(false)

    // 4. POST /auth/logout without CSRF header → 400
    const logoutNoCsrf = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { [SESSION_COOKIE]: sessionToken },
    })
    expect(logoutNoCsrf.statusCode).toBe(400)

    // 5. POST /auth/logout with CSRF header → 200
    const logoutRes = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { [SESSION_COOKIE]: sessionToken },
      headers: { "x-sermon-csrf": "1" },
    })
    expect(logoutRes.statusCode).toBe(200)
    expect(logoutRes.json()).toEqual({ ok: true })

    // Session revoked in DB
    const revokedSession = await db.selectFrom("sessions").selectAll().executeTakeFirst()
    expect(revokedSession?.revoked_at).not.toBeNull()

    // 6. GET /me after logout → 401
    const meAfterLogout = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { [SESSION_COOKIE]: sessionToken },
    })
    expect(meAfterLogout.statusCode).toBe(401)

    await app.close()
  })

  it("second login upserts the user and refreshes display_name", async () => {
    const app = await buildApp()

    // First login
    const startRes1 = await app.inject({ method: "GET", url: "/auth/google/start" })
    expect(startRes1.headers.location).toBeTruthy()
    const state1 = new URL(startRes1.headers.location as string).searchParams.get("state") as string
    const stateCookie1 = (startRes1.headers["set-cookie"] as string[])[0]
      ?.split(";")[0]
      ?.split("=")
      .slice(1)
      .join("=")
    await app.inject({
      method: "GET",
      url: `/auth/google/callback?code=c1&state=${state1}`,
      cookies: { [STATE_COOKIE]: stateCookie1 },
    })

    const after1 = await db.selectFrom("users").selectAll().execute()
    expect(after1).toHaveLength(1)
    expect(after1[0]?.display_name).toBe("Test User")

    // Second login with updated name
    const app2 = await buildApp({ ...STUB_CLAIMS, name: "Updated Name" })
    const startRes2 = await app2.inject({ method: "GET", url: "/auth/google/start" })
    expect(startRes2.headers.location).toBeTruthy()
    const state2 = new URL(startRes2.headers.location as string).searchParams.get("state") as string
    const stateCookie2 = (startRes2.headers["set-cookie"] as string[])[0]
      ?.split(";")[0]
      ?.split("=")
      .slice(1)
      .join("=")
    await app2.inject({
      method: "GET",
      url: `/auth/google/callback?code=c2&state=${state2}`,
      cookies: { [STATE_COOKIE]: stateCookie2 },
    })

    const after2 = await db.selectFrom("users").selectAll().execute()
    expect(after2).toHaveLength(1)
    expect(after2[0]?.display_name).toBe("Updated Name")
    expect(after2).toHaveLength(1) // still just one user

    await app.close()
    await app2.close()
  })

  it("/me returns 401 when no cookie is sent", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/me" })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("/callback rejects mismatched state", async () => {
    const app = await buildApp()
    const startRes = await app.inject({ method: "GET", url: "/auth/google/start" })
    const stateCookie = (startRes.headers["set-cookie"] as string[])[0]
      ?.split(";")[0]
      ?.split("=")
      .slice(1)
      .join("=")

    const res = await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=c&state=wrong-state",
      cookies: { [STATE_COOKIE]: stateCookie },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain("state")
    await app.close()
  })
})
