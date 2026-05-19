import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { z } from "zod"

const echoQuerySchema = z.object({
  message: z.string().min(1).max(200),
})

const echoResponseSchema = z.object({
  message: z.string(),
  length: z.number().int().nonnegative(),
})

export const echoRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/echo",
    {
      schema: {
        tags: ["system"],
        summary: "Echo a message back (exercises Zod validation + OpenAPI plumbing)",
        querystring: echoQuerySchema,
        response: { 200: echoResponseSchema },
      },
    },
    async (request) => {
      const { message } = request.query
      return { message, length: message.length }
    },
  )
}
