import OpenAI from "openai"

export interface OpenAIEmbedderOptions {
  apiKey: string
  model?: string
  dimensions?: number
  batchSize?: number
  maxRetries?: number
}

export interface Embedder {
  model: string
  dimensions: number
  embed(texts: string[]): Promise<number[][]>
}

export function createOpenAIEmbedder({
  apiKey,
  model = "text-embedding-3-small",
  dimensions = 1536,
  batchSize = 96,
  maxRetries = 5,
}: OpenAIEmbedderOptions): Embedder {
  const client = new OpenAI({ apiKey })

  async function embedBatch(batch: string[]): Promise<number[][]> {
    let attempt = 0
    while (true) {
      try {
        const response = await client.embeddings.create({
          model,
          input: batch,
          dimensions,
        })
        return response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding)
      } catch (err: unknown) {
        attempt += 1
        if (attempt >= maxRetries) throw err
        const status = (err as { status?: number }).status
        if (status !== 429 && (status === undefined || status < 500)) throw err
        const retryAfter = (err as { headers?: Record<string, string> }).headers?.["retry-after"]
        const delaySec = retryAfter ? Number(retryAfter) : 2 ** attempt
        await new Promise((r) => setTimeout(r, delaySec * 1000))
      }
    }
  }

  return {
    model,
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      const results: number[][] = new Array(texts.length)
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize)
        const vectors = await embedBatch(batch)
        for (let j = 0; j < vectors.length; j++) {
          results[i + j] = vectors[j] as number[]
        }
      }
      return results
    },
  }
}
