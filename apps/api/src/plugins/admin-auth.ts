import type { FastifyReply, FastifyRequest } from "fastify"
import fp from "fastify-plugin"
import { config } from "../config.js"

declare module "fastify" {
  interface FastifyInstance {
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export const adminAuthPlugin = fp(
  async (app) => {
    app.decorate("requireAdmin", async (request: FastifyRequest, reply: FastifyReply) => {
      const provided = request.headers["x-admin-key"]
      const expected = config.ADMIN_API_KEY

      if (!expected) {
        request.log.warn("ADMIN_API_KEY is not configured; rejecting admin request")
        await reply.code(401).send({ error: "admin access not configured" })
        return
      }

      if (typeof provided !== "string" || provided !== expected) {
        await reply.code(401).send({ error: "invalid admin key" })
        return
      }
    })
  },
  { name: "admin-auth" },
)
