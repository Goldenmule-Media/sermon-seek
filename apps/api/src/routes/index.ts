import type { FastifyInstance } from "fastify"
import { echoRoutes } from "./echo.js"
import { healthRoutes } from "./health.js"
import { homeRoutes } from "./home.js"
import { playlistsRoutes } from "./playlists.js"
import { searchRoutes } from "./search.js"
import { topicsRoutes } from "./topics.js"
import { videoDetailRoutes } from "./video-detail.js"
import { videoRelatedRoutes } from "./video-related.js"
import { videoSearchRoutes } from "./video-search.js"
import { videoTranscriptRoutes } from "./video-transcript.js"

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes)
  await app.register(echoRoutes)
  await app.register(homeRoutes)
  await app.register(playlistsRoutes)
  await app.register(searchRoutes)
  await app.register(topicsRoutes)
  await app.register(videoDetailRoutes)
  await app.register(videoRelatedRoutes)
  await app.register(videoSearchRoutes)
  await app.register(videoTranscriptRoutes)
}
