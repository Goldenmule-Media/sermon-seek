import { createHash, randomBytes } from "node:crypto"
import type { Database, UserRow } from "@sermon-search/db"
import type { FastifyReply, FastifyRequest } from "fastify"
import fp from "fastify-plugin"
import type { Kysely } from "kysely"
import { sql } from "kysely"
import { config } from "../config.js"

export type AuthenticatedUser = Pick<
  UserRow,
  "id" | "display_name" | "avatar_url" | "is_admin" | "status"
>

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser | null
    sessionId: string | null
  }
  interface FastifyInstance {
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function mintToken(): string {
  return randomBytes(32).toString("hex")
}

export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const ABSOLUTE_CAP_MS = 90 * 24 * 60 * 60 * 1000 // 90 days
const ROLL_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000 // roll when < 7 days remain
const LAST_SEEN_THROTTLE_MS = 60 * 1000 // update last_seen_at at most once per minute

export async function createSession(
  db: Kysely<Database>,
  userId: string,
  req: FastifyRequest,
): Promise<{ token: string; expiresAt: Date }> {
  const token = mintToken()
  const hash = hashToken(token)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS)

  await db
    .insertInto("sessions")
    .values({
      user_id: userId,
      session_token_hash: hash,
      user_agent: req.headers["user-agent"] ?? null,
      ip: req.ip ?? null,
      expires_at: expiresAt,
    })
    .execute()

  return { token, expiresAt }
}

export async function revokeSession(db: Kysely<Database>, sessionId: string): Promise<void> {
  await db
    .updateTable("sessions")
    .set({ revoked_at: new Date() })
    .where("id", "=", sessionId)
    .execute()
}

export const sessionPlugin = fp(
  async (app) => {
    app.decorateRequest("user", null)
    app.decorateRequest("sessionId", null)

    app.addHook("onRequest", async (request) => {
      const cookieName = config.SESSION_COOKIE_NAME
      const raw = request.cookies?.[cookieName]
      if (!raw) return

      const hash = hashToken(raw)
      const now = new Date()

      const row = await app.db
        .selectFrom("sessions")
        .innerJoin("users", "users.id", "sessions.user_id")
        .select([
          "sessions.id as sessionId",
          "sessions.created_at as sessionCreatedAt",
          "sessions.expires_at as expiresAt",
          "users.id as userId",
          "users.display_name",
          "users.avatar_url",
          "users.is_admin",
          "users.status",
          "users.last_seen_at",
        ])
        .where("sessions.session_token_hash", "=", hash)
        .where("sessions.revoked_at", "is", null)
        .where("sessions.expires_at", ">", now)
        .where("users.status", "=", "active")
        .executeTakeFirst()

      if (!row) return

      request.user = {
        id: row.userId,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        is_admin: row.is_admin,
        status: row.status,
      }
      request.sessionId = row.sessionId

      const createdAt = row.sessionCreatedAt as unknown as Date
      const expiresAt = row.expiresAt as unknown as Date
      const absoluteCap = new Date(createdAt.getTime() + ABSOLUTE_CAP_MS)
      const remainingMs = expiresAt.getTime() - now.getTime()

      if (remainingMs < ROLL_THRESHOLD_MS && now < absoluteCap) {
        const newExpiry = new Date(
          Math.min(now.getTime() + SESSION_DURATION_MS, absoluteCap.getTime()),
        )
        // best-effort roll — don't block the request
        void app.db
          .updateTable("sessions")
          .set({ expires_at: newExpiry })
          .where("id", "=", row.sessionId)
          .execute()
          .catch(() => {})
      }

      // best-effort last_seen_at update — throttled to avoid a write on every request
      const lastSeenAt = row.last_seen_at as unknown as Date
      if (now.getTime() - lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
        void app.db
          .updateTable("users")
          .set({ last_seen_at: sql`now()` })
          .where("id", "=", row.userId)
          .execute()
          .catch(() => {})
      }
    })

    app.decorate("requireUser", async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.code(401).send({ error: "unauthenticated" })
      }
    })

    app.decorate("requireAdmin", async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.code(401).send({ error: "unauthenticated" })
      }
      if (!request.user.is_admin) {
        return reply.code(403).send({ error: "forbidden" })
      }
    })
  },
  { name: "session", dependencies: ["db", "@fastify/cookie"] },
)
