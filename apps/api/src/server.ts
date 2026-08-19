import cookie from "@fastify/cookie"
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
import pino from "pino"
import { config } from "./config.js"
import { createLogBufferStream, logBuffer } from "./lib/log-buffer.js"
import { adminAuthPlugin } from "./plugins/admin-auth.js"
import { churchContextPlugin } from "./plugins/church-context.js"
import { dbPlugin } from "./plugins/db.js"
import { embedderPlugin } from "./plugins/embedder.js"
import { googleOAuthPlugin } from "./plugins/google-oauth.js"
import { rateLimitPlugin } from "./plugins/rate-limit.js"
import { sessionPlugin } from "./plugins/session.js"
import { youtubePlugin } from "./plugins/youtube.js"
import { registerRootRoutes, registerTenantRoutes } from "./routes/index.js"

export async function buildApp(): Promise<FastifyInstance> {
  if (!config.ADMIN_API_KEY) {
    throw new Error("ADMIN_API_KEY is required when admin routes are mounted")
  }
  if (!config.YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY is required when admin routes are mounted")
  }
  if (!config.GOOGLE_OAUTH_CLIENT_ID) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID is required")
  }
  if (!config.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is required")
  }
  if (!config.GOOGLE_OAUTH_REDIRECT_URI) {
    throw new Error("GOOGLE_OAUTH_REDIRECT_URI is required")
  }
  if (!config.COOKIE_SECRET) {
    throw new Error("COOKIE_SECRET is required")
  }

  const logLevel = process.env.LOG_LEVEL ?? "info"
  const app = Fastify({
    logger: {
      level: logLevel,
      stream: pino.multistream([
        { stream: process.stdout },
        { stream: createLogBufferStream(logBuffer) },
      ]),
    },
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(cors, {
    origin: config.CORS_ORIGIN,
    credentials: true,
  })

  await app.register(cookie, { secret: config.COOKIE_SECRET })

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
        { name: "videos", description: "Video metadata and transcript endpoints" },
        { name: "admin", description: "Admin / ingestion control endpoints" },
        { name: "requests", description: "Self-service ingestion request endpoints" },
      ],
    },
    transform: jsonSchemaTransform,
  })

  await app.register(dbPlugin)
  await app.register(embedderPlugin)
  await app.register(youtubePlugin)
  await app.register(googleOAuthPlugin)
  await app.register(sessionPlugin)
  await app.register(adminAuthPlugin)
  await app.register(rateLimitPlugin)
  await app.register(churchContextPlugin)

  await app.register(
    async (v1) => {
      v1.get("/openapi.json", { schema: { hide: true } }, async () => v1.swagger())

      await v1.register(swaggerUi, {
        routePrefix: "/docs",
        uiConfig: { docExpansion: "list", deepLinking: false },
      })

      await registerRootRoutes(v1)

      await v1.register(
        async (tenant) => {
          tenant.useChurchContext(tenant)
          await registerTenantRoutes(tenant)
        },
        { prefix: "/:church" },
      )
    },
    { prefix: "/v1" },
  )

  return app
}
