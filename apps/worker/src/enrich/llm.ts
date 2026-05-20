import OpenAI from "openai"

const MAX_TRANSCRIPT_CHARS = 12_000

export interface EnrichmentOutput {
  summary: string
  topics: string[]
}

export interface Enricher {
  model: string
  enrich(transcriptText: string, title: string): Promise<EnrichmentOutput>
}

export interface OpenAIEnricherOptions {
  apiKey: string
  model?: string
  maxRetries?: number
}

const enrichmentSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One-paragraph summary of the sermon" },
    topics: {
      type: "array",
      items: { type: "string" },
      minItems: 5,
      maxItems: 10,
      description: "5–10 short noun phrases describing the sermon topics",
    },
  },
  required: ["summary", "topics"],
  additionalProperties: false,
} as const

export function createOpenAIEnricher({
  apiKey,
  model = "gpt-4o-mini",
  maxRetries = 5,
}: OpenAIEnricherOptions): Enricher {
  const client = new OpenAI({ apiKey })

  async function callWithRetry(transcriptText: string, title: string): Promise<EnrichmentOutput> {
    const excerpt = transcriptText.slice(0, MAX_TRANSCRIPT_CHARS)
    const prompt = `You are a sermon analyst. Given a sermon title and transcript excerpt, produce:
- A one-paragraph summary (3-5 sentences)
- 5-10 short topic noun phrases (lowercase, slug-friendly, e.g. "grace", "faith in action")

Title: ${title}

Transcript excerpt:
${excerpt}`

    let attempt = 0
    while (true) {
      try {
        const response = await client.chat.completions.create({
          model,
          messages: [{ role: "user", content: prompt }],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "sermon_enrichment",
              strict: true,
              schema: enrichmentSchema,
            },
          },
        })
        const content = response.choices[0]?.message?.content ?? "{}"
        const parsed = JSON.parse(content) as EnrichmentOutput
        return {
          summary: parsed.summary ?? "",
          topics: Array.isArray(parsed.topics) ? parsed.topics : [],
        }
      } catch (err: unknown) {
        attempt += 1
        if (attempt >= maxRetries) throw err
        const status = (err as { status?: number }).status
        if (status !== 429 && (status === undefined || status < 500)) throw err
        const headers = (err as { headers?: Record<string, string> }).headers
        const retryAfter = headers?.["retry-after"]
        const delaySec = retryAfter ? Number(retryAfter) : 2 ** attempt
        await new Promise((r) => setTimeout(r, delaySec * 1000))
      }
    }
  }

  return {
    model,
    enrich: callWithRetry,
  }
}
