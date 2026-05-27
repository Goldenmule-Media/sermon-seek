import type { FastifyInstance } from "fastify"
import { adminChurchesRoutes } from "./admin-churches.js"
import { dashboardSummaryRoutes } from "./admin-dashboard.js"
import { adminHealthRoutes } from "./admin-health.js"
import { adminRequestsRoutes } from "./admin-requests.js"
import { adminRoutes } from "./admin.js"
import { authRoutes } from "./auth.js"
import { echoRoutes } from "./echo.js"
import { filterRulesRoutes } from "./filter-rules.js"
import { healthRoutes } from "./health.js"
import { homeRoutes } from "./home.js"
import { meRequestsRoutes } from "./me-requests.js"
import { playlistsRoutes } from "./playlists.js"
import { requestsRoutes } from "./requests.js"
import { searchRoutes } from "./search.js"
import { topicsRoutes } from "./topics.js"
import { videoDetailRoutes } from "./video-detail.js"
import { videoRelatedRoutes } from "./video-related.js"
import { videoSearchRoutes } from "./video-search.js"
import { videoTranscriptRoutes } from "./video-transcript.js"

export async function registerRootRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes)
  await app.register(echoRoutes)
  await app.register(adminRoutes)
  await app.register(filterRulesRoutes)
  await app.register(authRoutes)
  await app.register(requestsRoutes)
  await app.register(meRequestsRoutes)
  await app.register(adminRequestsRoutes)
  await app.register(adminChurchesRoutes)
  await app.register(dashboardSummaryRoutes)
  await app.register(adminHealthRoutes)
}

export async function registerTenantRoutes(app: FastifyInstance): Promise<void> {
  await app.register(homeRoutes)
  await app.register(playlistsRoutes)
  await app.register(searchRoutes)
  await app.register(topicsRoutes)
  await app.register(videoDetailRoutes)
  await app.register(videoRelatedRoutes)
  await app.register(videoSearchRoutes)
  await app.register(videoTranscriptRoutes)
}
