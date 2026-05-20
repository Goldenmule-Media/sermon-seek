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
    summary: {
      type: "string",
      description:
        "1–2 sentence summary, ~280 characters or less. Describe what the video actually is and what it covers.",
    },
    topics: {
      type: "array",
      items: { type: "string" },
      minItems: 5,
      maxItems: 10,
      description: "5–10 short noun phrases describing the topics covered",
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
    const prompt = `You are analyzing a recorded video from a church's channel. The content may be a sermon, devotional, Q&A, panel, livestream, announcement, interview, worship, or anything else — describe what it actually is, don't assume.

Given the title and transcript excerpt, produce:
- summary: 1–2 sentences, ~280 characters or less. Start by naming the format (e.g. "A sermon on…", "A devotional reflecting on…", "A Q&A about…"). Be concrete about the subject; skip filler like "in this video".
- topics: 5–10 short noun phrases describing what's covered (lowercase, slug-friendly, e.g. "grace", "faith in action").

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
