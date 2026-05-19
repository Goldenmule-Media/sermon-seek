import { timingSafeEqual } from "node:crypto"
import type { FastifyReply, FastifyRequest } from "fastify"
import fp from "fastify-plugin"
import { config } from "../config.js"

declare module "fastify" {
  interface FastifyInstance {
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
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
    app.decorate("requireAdmin", async (request: FastifyRequest, reply: FastifyReply) => {
      const provided = request.headers["x-admin-key"]
      const expected = config.ADMIN_API_KEY

      if (!expected || typeof provided !== "string" || !safeEqual(provided, expected)) {
        await reply.code(401).send({ error: "invalid admin key" })
        return
      }
    })
  },
  { name: "admin-auth" },
)
