import { z } from "zod"

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().min(1).default("0.0.0.0"),
  ADMIN_API_KEY: z.string().optional(),
  CORS_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
})

export type Config = z.infer<typeof envSchema>

export const config: Config = envSchema.parse(process.env)
