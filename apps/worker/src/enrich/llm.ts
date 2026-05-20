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
        "1–2 sentence summary, 280 characters or fewer. Lead with the substantive content, not the format wrapper. Never start with 'The sermon', 'This sermon', 'The speaker', 'In this video', 'A worship service', or similar boilerplate openers.",
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
    const prompt = `You are summarizing a recorded video from a church's channel. Tell a viewer what they would actually get from watching.

HARD LIMIT: summary must be 240 characters or fewer (about 35–40 words). Count characters; cut words to fit. Tight beats complete — if you can't fit it cleanly, drop the second sentence.

Style rules:
- Write 1–2 sentences. Lead with the substance.
- Do not start with "The sermon...", "This sermon...", "The speaker...", "In this video...", "The leaders...", "A worship service...". Start with the actual subject.
- For a sermon embedded in a service: summarize the sermon (passage + main idea). Ignore the surrounding service, music, prayer, or liturgy.
- For a scripture reading or devotional: name the passage and the angle on it.
- For a Q&A, panel, interview, or podcast: name the conversation topic and the distinctive angle. The format label is OK here ("A Q&A about…").
- For an announcement or event recap: what was announced or what happened, and who it's for.
- Use specific nouns; avoid hedge words like "various", "several", "themes of", "different aspects".

Good (sermon): "Matthew 11:28 and 5:6 on coming to Christ for rest and hungering for righteousness — God meets the weary with peace, not condemnation."
Good (panel): "A panel on parenting through crisis after cartel violence in Guadalajara, with leaders discussing how families and churches steady kids when fear surges."
Bad: "The sermon focuses on the importance of…" (filler opener)
Bad: "A worship service centered on…" (wrapper, not content)

Also produce 5–10 short topic noun phrases (lowercase, slug-friendly, e.g. "grace", "faith in action").

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
