import { z } from "zod"

export const instanceConfigSchema = z.object({
  baseUrl: z.string().url(),
  adminKey: z.string().min(1),
})

export const cliConfigSchema = z.object({
  currentInstance: z.string().optional(),
  instances: z.record(z.string(), instanceConfigSchema).default({}),
})

export type InstanceConfig = z.infer<typeof instanceConfigSchema>
export type CliConfig = z.infer<typeof cliConfigSchema>

export const defaultConfig: CliConfig = { instances: {} }
