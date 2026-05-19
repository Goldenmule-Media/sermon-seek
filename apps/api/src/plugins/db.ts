import { type Database, createDb } from "@sermon-search/db"
import fp from "fastify-plugin"
import type { Kysely } from "kysely"
import { config } from "../config.js"

declare module "fastify" {
  interface FastifyInstance {
    db: Kysely<Database>
  }
}

export const dbPlugin = fp(
  async (app) => {
    const db = createDb(config.DATABASE_URL)
    app.decorate("db", db)
    app.addHook("onClose", async () => {
      await db.destroy()
    })
  },
  { name: "db" },
)
