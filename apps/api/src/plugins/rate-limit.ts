import type { FastifyReply, FastifyRequest } from "fastify"
import fp from "fastify-plugin"

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) store.delete(key)
  }
}, 60_000).unref()

export function __resetForTests(): void {
  store.clear()
}

function checkAndIncrement(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const storeKey = `${bucket}:${key}`
  const now = Date.now()

  const entry = store.get(storeKey)
  if (!entry || now >= entry.resetAt) {
    store.set(storeKey, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  if (entry.count >= limit) {
    const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000)
    return { allowed: false, retryAfterSeconds }
  }

  entry.count++
  return { allowed: true, retryAfterSeconds: 0 }
}

export type RateLimitPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>

interface RateLimiterConfig {
  bucket: string
  limit: number
  windowMs: number
  keyFn: (request: FastifyRequest) => string
}

declare module "fastify" {
  interface FastifyInstance {
    rateLimit(config: RateLimiterConfig): RateLimitPreHandler
  }
}

export const rateLimitPlugin = fp(
  async (app) => {
    app.decorate("rateLimit", (config: RateLimiterConfig): RateLimitPreHandler => {
      const { bucket, limit, windowMs, keyFn } = config
      return async (request: FastifyRequest, reply: FastifyReply) => {
        const key = keyFn(request)
        const result = checkAndIncrement(bucket, key, limit, windowMs)
        if (!result.allowed) {
          reply.header("Retry-After", String(result.retryAfterSeconds))
          return reply.code(429).send({
            error: "rate_limited",
            retry_after_seconds: result.retryAfterSeconds,
          })
        }
      }
    })
  },
  { name: "rate-limit" },
)
