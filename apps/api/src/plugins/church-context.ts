import { type ScopedDb, createScopedDb } from "@sermon-search/db"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import fp from "fastify-plugin"

type ChurchRecord = { id: string; slug: string; name: string }

declare module "fastify" {
  interface FastifyInstance {
    resolveChurchBySlug(slug: string): Promise<ChurchRecord | null>
    requireChurchContext: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    churchId: string
    churchSlug: string
    scopedDb: ScopedDb
  }
}

export async function resolveChurchOrReply(
  app: FastifyInstance,
  slug: string,
  reply: FastifyReply,
): Promise<ChurchRecord | null> {
  const church = await app.resolveChurchBySlug(slug)
  if (!church) {
    await reply.code(404).send({ error: "church not found" })
    return null
  }
  return church
}

export const churchContextPlugin = fp(
  async (app) => {
    const cache = new Map<string, ChurchRecord>()

    const resolveChurchBySlug = async (slug: string): Promise<ChurchRecord | null> => {
      const cached = cache.get(slug)
      if (cached) return cached

      const row = await app.db
        .selectFrom("churches")
        .select(["id", "slug", "name"])
        .where("slug", "=", slug)
        .executeTakeFirst()

      if (!row) return null
      const record: ChurchRecord = { id: row.id, slug: row.slug, name: row.name }
      cache.set(slug, record)
      return record
    }

    app.decorate("resolveChurchBySlug", resolveChurchBySlug)
    app.decorateRequest("churchId", "")
    app.decorateRequest("churchSlug", "")
    // biome-ignore lint/suspicious/noExplicitAny: scopedDb is populated by the preHandler
    app.decorateRequest("scopedDb", null as any)

    app.decorate("requireChurchContext", async (request: FastifyRequest, reply: FastifyReply) => {
      const pathSlug = (request.params as Record<string, string> | undefined)?.church
      const headerSlug = request.headers["x-church-slug"] as string | undefined

      let slug: string
      if (pathSlug && headerSlug) {
        if (pathSlug !== headerSlug) {
          await reply.code(400).send({ error: "church slug mismatch" })
          return
        }
        slug = pathSlug
      } else if (pathSlug) {
        slug = pathSlug
      } else if (headerSlug) {
        slug = headerSlug
      } else {
        await reply.code(400).send({ error: "church slug required" })
        return
      }

      const church = await resolveChurchBySlug(slug)
      if (!church) {
        await reply.code(404).send({ error: "church not found" })
        return
      }

      request.churchId = church.id
      request.churchSlug = church.slug
      request.scopedDb = createScopedDb(app.db, church.id)
    })
  },
  { name: "church-context", dependencies: ["db"] },
)
