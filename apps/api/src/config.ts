import { z } from "zod"

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().min(1).default("0.0.0.0"),
  ADMIN_API_KEY: z.string().optional(),
  CORS_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  YOUTUBE_API_KEY: z.string().optional(),
  CACHE_DIR: z.string().optional(),
  SLUG_ALIAS_TTL_DAYS: z.coerce.number().int().positive().default(90),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  COOKIE_SECRET: z.string().min(32).optional(),
  SESSION_COOKIE_NAME: z.string().default("sermon_session"),
  STATE_COOKIE_NAME: z.string().default("sermon_oauth_state"),
  WEB_BASE_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_BASE_URL: z.string().url().optional(),
  ADMIN_ALLOWED_EMAILS: z.string().optional(),
  COOKIE_SECURE: z.coerce.boolean().optional(),
  LIMITED_INGEST_TOKEN_CAP: z.coerce.number().int().positive().default(750_000),
  LOG_BUFFER_SIZE: z.coerce.number().int().positive().default(1000),
})

export type Config = z.infer<typeof envSchema>

export const config: Config = envSchema.parse(process.env)
