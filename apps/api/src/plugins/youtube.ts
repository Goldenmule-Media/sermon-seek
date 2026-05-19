import { YoutubeClient } from "@sermon-search/worker"
import fp from "fastify-plugin"
import { config } from "../config.js"

declare module "fastify" {
  interface FastifyInstance {
    youtube: YoutubeClient
  }
}

export const youtubePlugin = fp(
  async (app) => {
    const apiKey = config.YOUTUBE_API_KEY
    if (!apiKey) throw new Error("YOUTUBE_API_KEY is required")
    const client = new YoutubeClient({ apiKey })
    app.decorate("youtube", client)
  },
  { name: "youtube" },
)
