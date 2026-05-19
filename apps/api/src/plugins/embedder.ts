import { type Embedder, createOpenAIEmbedder } from "@sermon-search/embeddings"
import fp from "fastify-plugin"
import { config } from "../config.js"

declare module "fastify" {
  interface FastifyInstance {
    embedder: Embedder | null
  }
}

export const embedderPlugin = fp(
  async (app) => {
    const embedder = config.OPENAI_API_KEY
      ? createOpenAIEmbedder({
          apiKey: config.OPENAI_API_KEY,
          model: config.EMBEDDING_MODEL,
        })
      : null
    app.decorate("embedder", embedder)
  },
  { name: "embedder" },
)
