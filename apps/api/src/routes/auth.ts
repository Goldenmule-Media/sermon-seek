import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type { AuthMeResponse } from "@sermon-search/types"
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { sql } from "kysely"
import { z } from "zod"
import { config } from "../config.js"
import { createSession, revokeSession } from "../plugins/session.js"

const COOKIE_OPTS = {
  httpOnly: true,
  secure: config.COOKIE_SECURE ?? process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

function generateState(): string {
  return randomBytes(16).toString("hex")
}

function safeStateCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

function validateReturnTo(value: string | undefined): string {
  if (!value) return config.WEB_BASE_URL
  // Accept relative paths only
  if (/^\/[^/]/.test(value) || value === "/") return value
  // Accept same-origin absolute URLs
  try {
    const u = new URL(value)
    const base = new URL(config.WEB_BASE_URL)
    if (u.origin === base.origin) return value
  } catch {
    // fall through
  }
  return config.WEB_BASE_URL
}

export function requireCsrfHeader(
  request: { headers: Record<string, string | string[] | undefined> },
  reply: { code: (n: number) => { send: (b: unknown) => Promise<void> } },
): Promise<void> {
  if (request.headers["x-sermon-csrf"] !== "1") {
    return reply.code(400).send({ error: "missing CSRF header" })
  }
  return Promise.resolve()
}

const startQuerySchema = z.object({
  return_to: z.string().optional(),
})

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string(),
  error: z.string().optional(),
})

const meResponseSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  is_admin: z.boolean(),
})

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /auth/google/start
  app.get(
    "/auth/google/start",
    {
      schema: {
        tags: ["auth"],
        summary: "Initiate Google OAuth flow",
        querystring: startQuerySchema,
        response: { 302: z.null() },
      },
    },
    async (request, reply) => {
      const returnTo = validateReturnTo(request.query.return_to)
      const state = generateState()
      const { verifier, challenge } = generatePkce()

      const stateCookieValue = JSON.stringify({ state, verifier, returnTo })

      reply.setCookie(config.STATE_COOKIE_NAME, stateCookieValue, {
        ...COOKIE_OPTS,
        maxAge: 300, // 5 minutes
        signed: true,
        path: `${app.prefix ?? ""}/auth/google`,
      })

      const redirectUri = config.GOOGLE_OAUTH_REDIRECT_URI
      const url = app.googleOAuth.buildAuthorizeUrl({
        state,
        codeChallenge: challenge,
        redirectUri,
      })

      return reply.redirect(url, 302)
    },
  )

  // GET /auth/google/callback
  app.get(
    "/auth/google/callback",
    {
      schema: {
        tags: ["auth"],
        summary: "Google OAuth callback",
        querystring: callbackQuerySchema,
        response: {
          302: z.null(),
          400: z.object({ error: z.string() }),
          403: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { code, state: queryState, error: oauthError } = request.query

      if (oauthError) {
        return reply.code(400).send({ error: `OAuth error: ${oauthError}` })
      }

      if (!code) {
        return reply.code(400).send({ error: "missing authorization code" })
      }

      // Read + validate signed state cookie
      const rawStateCookie = request.unsignCookie(request.cookies[config.STATE_COOKIE_NAME] ?? "")
      if (!rawStateCookie.valid || !rawStateCookie.value) {
        return reply.code(400).send({ error: "missing or invalid state cookie" })
      }

      let cookiePayload: { state: string; verifier: string; returnTo: string }
      try {
        cookiePayload = JSON.parse(rawStateCookie.value)
      } catch {
        return reply.code(400).send({ error: "malformed state cookie" })
      }

      if (!safeStateCompare(cookiePayload.state, queryState)) {
        return reply.code(400).send({ error: "state mismatch" })
      }

      // Clear state cookie immediately
      reply.clearCookie(config.STATE_COOKIE_NAME, { path: `${app.prefix ?? ""}/auth/google` })

      const redirectUri = config.GOOGLE_OAUTH_REDIRECT_URI

      let idToken: string
      try {
        const result = await app.googleOAuth.exchangeCode({
          code,
          codeVerifier: cookiePayload.verifier,
          redirectUri,
        })
        idToken = result.idToken
      } catch {
        return reply.code(400).send({ error: "token exchange failed" })
      }

      let claims: { sub: string; name?: string; picture?: string }
      try {
        claims = await app.googleOAuth.verifyIdToken(idToken)
      } catch {
        return reply.code(400).send({ error: "invalid ID token" })
      }

      // Upsert user by google_sub
      const user = await app.db
        .insertInto("users")
        .values({
          google_sub: claims.sub,
          display_name: claims.name ?? null,
          avatar_url: claims.picture ?? null,
          last_seen_at: sql`now()`,
        })
        .onConflict((oc) =>
          oc.column("google_sub").doUpdateSet({
            display_name: claims.name ?? null,
            avatar_url: claims.picture ?? null,
            last_seen_at: sql`now()`,
          }),
        )
        .returning(["id", "status"])
        .executeTakeFirstOrThrow()

      if (user.status !== "active") {
        return reply.code(403).send({ error: "account suspended or deleted" })
      }

      const { token, expiresAt } = await createSession(app.db, user.id, request)

      reply.setCookie(config.SESSION_COOKIE_NAME, token, {
        ...COOKIE_OPTS,
        expires: expiresAt,
      })

      return reply.redirect(cookiePayload.returnTo, 302)
    },
  )

  // POST /auth/logout
  app.post(
    "/auth/logout",
    {
      preHandler: [requireCsrfHeader as never, app.requireUser],
      schema: {
        tags: ["auth"],
        summary: "Revoke current session",
        response: {
          200: z.object({ ok: z.boolean() }),
          400: z.object({ error: z.string() }),
          401: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      if (request.sessionId) {
        await revokeSession(app.db, request.sessionId)
      }
      reply.clearCookie(config.SESSION_COOKIE_NAME, { path: "/" })
      return reply.send({ ok: true })
    },
  )

  // GET /me
  app.get(
    "/me",
    {
      preHandler: app.requireUser,
      schema: {
        tags: ["auth"],
        summary: "Return the current authenticated user",
        response: {
          200: meResponseSchema,
          401: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: "unauthenticated" })
      const user = request.user
      const body: AuthMeResponse = {
        id: user.id,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        is_admin: user.is_admin,
      }
      return reply.send(body)
    },
  )
}
