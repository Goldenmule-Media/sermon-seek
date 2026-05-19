import cors from "@fastify/cors"
import swagger from "@fastify/swagger"
import swaggerUi from "@fastify/swagger-ui"
import Fastify, { type FastifyInstance } from "fastify"
import {
  type ZodTypeProvider,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod"
import { config } from "./config.js"
import { adminAuthPlugin } from "./plugins/admin-auth.js"
import { dbPlugin } from "./plugins/db.js"
import { registerRoutes } from "./routes/index.js"

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(cors, {
    origin: config.CORS_ORIGIN,
    credentials: true,
  })

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Sermon Search API",
        description: "Internal API for the sermon search service.",
        version: "0.0.0",
      },
      servers: [{ url: "/v1" }],
      tags: [
        { name: "system", description: "Service health & diagnostics" },
        { name: "home", description: "Landing-page aggregate endpoint" },
        { name: "search", description: "Full-text search endpoints" },
      ],
    },
    transform: jsonSchemaTransform,
  })

  await app.register(adminAuthPlugin)
  await app.register(dbPlugin)

  await app.register(
    async (v1) => {
      v1.get("/openapi.json", { schema: { hide: true } }, async () => v1.swagger())

      await v1.register(swaggerUi, {
        routePrefix: "/docs",
        uiConfig: { docExpansion: "list", deepLinking: false },
      })

      await registerRoutes(v1)
    },
    { prefix: "/v1" },
  )

  return app
}
