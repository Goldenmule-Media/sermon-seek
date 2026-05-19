import type { FastifyInstance } from "fastify"
import { echoRoutes } from "./echo.js"
import { healthRoutes } from "./health.js"
import { homeRoutes } from "./home.js"
import { searchRoutes } from "./search.js"
import { videoDetailRoutes } from "./video-detail.js"
import { videoSearchRoutes } from "./video-search.js"
import { videoTranscriptRoutes } from "./video-transcript.js"

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes)
  await app.register(echoRoutes)
  await app.register(homeRoutes)
  await app.register(searchRoutes)
  await app.register(videoDetailRoutes)
  await app.register(videoSearchRoutes)
  await app.register(videoTranscriptRoutes)
}
