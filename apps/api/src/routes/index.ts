import type { FastifyInstance } from "fastify"
import { echoRoutes } from "./echo.js"
import { healthRoutes } from "./health.js"

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes)
  await app.register(echoRoutes)
}
