import { timingSafeEqual } from "node:crypto"
import type { FastifyReply, FastifyRequest } from "fastify"
import fp from "fastify-plugin"
import { config } from "../config.js"
import { auditWrite } from "../lib/audit.js"

declare module "fastify" {
  interface FastifyInstance {
    requireAdminApiKey: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdminOrApiKey: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Compare against a dummy buffer to avoid length-based timing leaks
    timingSafeEqual(bufA, Buffer.alloc(bufA.length))
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export const adminAuthPlugin = fp(
  async (app) => {
    app.decorate("requireAdminApiKey", async (request: FastifyRequest, reply: FastifyReply) => {
      const provided = request.headers["x-admin-key"]
      const expected = config.ADMIN_API_KEY

      if (!expected || typeof provided !== "string" || !safeEqual(provided, expected)) {
        await reply.code(401).send({ error: "invalid admin key" })
        return
      }
    })

    app.decorate("requireAdminOrApiKey", async (request: FastifyRequest, reply: FastifyReply) => {
      // 1. Session admin
      if (request.user?.is_admin === true) return

      // 2. x-admin-key fallback
      const provided = request.headers["x-admin-key"]
      const expected = config.ADMIN_API_KEY
      if (expected && typeof provided === "string" && safeEqual(provided, expected)) return

      // 3. Signed-in but not admin → audit + 403
      if (request.user) {
        void auditWrite(app.db, {
          user_id: request.user.id,
          action: "admin.access.denied",
          target_type: "user",
          target_id: request.user.id,
          payload: { path: request.url, method: request.method },
        }).catch((err) => app.log.error({ err }, "admin-auth: failed to write audit row"))
        await reply.code(403).send({ error: "forbidden" })
        return
      }

      // 4. No session, no key → 401
      await reply.code(401).send({ error: "unauthenticated" })
    })
  },
  { name: "admin-auth" },
)
