import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"

const healthResponseSchema = z.object({
  status: z.literal("ok"),
  uptime_s: z.number(),
})

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["system"],
        summary: "Liveness check",
        response: { 200: healthResponseSchema },
      },
    },
    async () => ({
      status: "ok" as const,
      uptime_s: process.uptime(),
    }),
  )
}
