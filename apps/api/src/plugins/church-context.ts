import { type ScopedDb, createScopedDb } from "@sermon-search/db"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import fp from "fastify-plugin"

type ChurchRecord = { id: string; slug: string; name: string }

declare module "fastify" {
  interface FastifyInstance {
    resolveChurchBySlug(slug: string): Promise<ChurchRecord | null>
    evictSlug(slug: string): void
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

const SLUG_MISS = Symbol("miss")

export const churchContextPlugin = fp(
  async (app) => {
    const cache = new Map<string, ChurchRecord | typeof SLUG_MISS>()

    const resolveChurchBySlug = async (slug: string): Promise<ChurchRecord | null> => {
      const cached = cache.get(slug)
      if (cached !== undefined) return cached === SLUG_MISS ? null : cached

      const row = await app.db
        .selectFrom("churches")
        .select(["id", "slug", "name"])
        .where("slug", "=", slug)
        .executeTakeFirst()

      if (row) {
        const record: ChurchRecord = { id: row.id, slug: row.slug, name: row.name }
        cache.set(slug, record)
        return record
      }

      const aliasRow = await app.db
        .selectFrom("church_slug_aliases as a")
        .innerJoin("churches as c", "c.id", "a.church_id")
        .select(["c.id", "c.slug", "c.name"])
        .where("a.slug", "=", slug)
        .executeTakeFirst()

      if (!aliasRow) {
        cache.set(slug, SLUG_MISS)
        return null
      }
      const aliasRecord: ChurchRecord = {
        id: aliasRow.id,
        slug: aliasRow.slug,
        name: aliasRow.name,
      }
      cache.set(slug, aliasRecord)
      return aliasRecord
    }

    app.decorate("resolveChurchBySlug", resolveChurchBySlug)
    app.decorate("evictSlug", (slug: string) => {
      cache.delete(slug)
    })
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

      const isAlias = church.slug !== slug
      if (isAlias && pathSlug) {
        const newUrl = request.url.replace(`/${pathSlug}`, `/${church.slug}`)
        await reply.code(308).header("Location", newUrl).send()
        return
      }
      if (isAlias) {
        reply.header("X-Canonical-Church-Slug", church.slug)
      }

      request.churchId = church.id
      request.churchSlug = church.slug
      request.scopedDb = createScopedDb(app.db, church.id)
    })
  },
  { name: "church-context", dependencies: ["db"] },
)
