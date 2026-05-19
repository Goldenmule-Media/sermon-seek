import { config } from "./config.js"
import { buildApp } from "./server.js"

async function main(): Promise<void> {
  const app = await buildApp().catch((err: unknown) => {
    console.error(`[fatal] ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  })

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info({ signal }, "shutting down")
    try {
      await app.close()
      process.exit(0)
    } catch (err) {
      app.log.error({ err }, "error during shutdown")
      process.exit(1)
    }
  }

  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))

  try {
    await app.listen({ port: config.PORT, host: config.HOST })
  } catch (err) {
    app.log.error({ err }, "failed to start server")
    process.exit(1)
  }
}

void main()
