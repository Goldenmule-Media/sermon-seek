import { type ScopedDb, createScopedDb } from "@sermon-search/db"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import fp from "fastify-plugin"

type ChurchRecord = { id: string; slug: string; name: string }

declare module "fastify" {
  interface FastifyInstance {
    resolveChurchBySlug(slug: string): Promise<ChurchRecord | null>
    evictSlug(slug: string): void
    /**
     * Wire church resolution onto a route scope. Registers both hooks it needs
     * — see churchPathSlug on FastifyRequest for why there are two — so a
     * caller cannot half-wire it.
     */
    useChurchContext(scope: FastifyInstance): void
    requireChurchContext: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    churchId: string
    churchSlug: string
    scopedDb: ScopedDb
    /**
     * The `:church` path segment, captured at onRequest.
     *
     * It cannot be read off request.params in the preHandler: a route that
     * declares a zod `params` schema has its params replaced at preValidation
     * with only the keys that schema names, and none of them name `church`.
     * Reading it later silently yielded undefined on exactly those routes,
     * which made them fall back to the x-church-slug header.
     */
    churchPathSlug: string
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
    app.decorateRequest("churchPathSlug", "")

    // Routing populates request.params before onRequest, and validation does
    // not run until preValidation, so this is the last point at which the raw
    // path slug is guaranteed to be present for every tenant route.
    const captureChurchPathSlug = async (request: FastifyRequest) => {
      const pathSlug = (request.params as Record<string, string> | undefined)?.church
      if (pathSlug) request.churchPathSlug = pathSlug
    }
    // biome-ignore lint/suspicious/noExplicitAny: scopedDb is populated by the preHandler
    app.decorateRequest("scopedDb", null as any)

    app.decorate("requireChurchContext", async (request: FastifyRequest, reply: FastifyReply) => {
      const pathSlug = request.churchPathSlug || undefined
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
        const segment = `/${pathSlug}`
        const idx = request.url.indexOf(segment)
        const newUrl =
          idx === -1
            ? request.url
            : `${request.url.slice(0, idx)}/${church.slug}${request.url.slice(idx + segment.length)}`
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

    app.decorate("useChurchContext", (scope: FastifyInstance) => {
      scope.addHook("onRequest", captureChurchPathSlug)
      scope.addHook("preHandler", scope.requireChurchContext)
    })
  },
  { name: "church-context", dependencies: ["db"] },
)
