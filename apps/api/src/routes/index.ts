import type { FastifyInstance } from "fastify"
import { echoRoutes } from "./echo.js"
import { healthRoutes } from "./health.js"
import { homeRoutes } from "./home.js"
import { searchRoutes } from "./search.js"
import { videoSearchRoutes } from "./video-search.js"

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes)
  await app.register(echoRoutes)
  await app.register(homeRoutes)
  await app.register(searchRoutes)
  await app.register(videoSearchRoutes)
}
