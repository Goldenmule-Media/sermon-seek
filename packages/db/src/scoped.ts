import type { InsertQueryBuilder, InsertResult, Insertable, Kysely } from "kysely"
import type { Database } from "./index.js"

export const TENANT_TABLES = new Set<string>([
  "channels",
  "playlists",
  "videos",
  "transcript_chunks",
  "embeddings",
  "topics",
  "videos_with_transcripts",
])

export type TenantTable =
  | "channels"
  | "playlists"
  | "videos"
  | "transcript_chunks"
  | "embeddings"
  | "topics"
  | "videos_with_transcripts"

export function assertChurchId(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("ScopedDb requires a non-empty churchId")
  }
}

function parseTableRef(ref: string): { table: string; alias: string } {
  const match = ref.match(/^(\S+)\s+as\s+(\S+)$/i)
  if (match?.[1] && match[2]) {
    return { table: match[1], alias: match[2] }
  }
  return { table: ref, alias: ref }
}

// Tenant-table inserts come in pre-scoped via the wrapper, so callers must not
// be required to supply church_id. This Insertable variant lets the church_id
// column be omitted (or, if present, must match the scope at runtime).
type ScopedInsertable<TB extends keyof Database & string> = TB extends TenantTable
  ? Omit<Insertable<Database[TB]>, "church_id"> & { church_id?: string }
  : Insertable<Database[TB]>

/**
 * The only legitimate way to query tenant-bearing tables. Wraps a Kysely
 * instance and auto-applies a church_id filter to every tenant-scoped query.
 * The type-level + runtime guard pair prevents both TS-escape-hatch leaks and
 * accidental unscoped access.
 */
export class ScopedDb {
  readonly #db: Kysely<Database>
  readonly #churchId: string

  constructor(db: Kysely<Database>, churchId: string) {
    assertChurchId(churchId)
    this.#db = db
    this.#churchId = churchId
  }

  get churchId(): string {
    return this.#churchId
  }

  // The method signatures defer to the underlying Kysely instance so the full
  // suite of selectFrom/updateTable/deleteFrom overloads (aliased tables,
  // expression-based from clauses, etc.) is preserved for callers.
  readonly selectFrom: Kysely<Database>["selectFrom"] = ((ref: unknown) => {
    if (typeof ref !== "string") {
      // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
      return this.#db.selectFrom(ref as any)
    }
    const { table, alias } = parseTableRef(ref)
    // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
    const qb = this.#db.selectFrom(ref as any)
    if (TENANT_TABLES.has(table)) {
      // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
      return (qb as any).where(`${alias}.church_id`, "=", this.#churchId)
    }
    return qb
    // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
  }) as any

  readonly updateTable: Kysely<Database>["updateTable"] = ((ref: unknown) => {
    if (typeof ref !== "string") {
      // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
      return this.#db.updateTable(ref as any)
    }
    const { table, alias } = parseTableRef(ref)
    // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
    const qb = this.#db.updateTable(ref as any)
    if (TENANT_TABLES.has(table)) {
      // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
      return (qb as any).where(`${alias}.church_id`, "=", this.#churchId)
    }
    return qb
    // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
  }) as any

  readonly deleteFrom: Kysely<Database>["deleteFrom"] = ((ref: unknown) => {
    if (typeof ref !== "string") {
      // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
      return this.#db.deleteFrom(ref as any)
    }
    const { table, alias } = parseTableRef(ref)
    // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
    const qb = this.#db.deleteFrom(ref as any)
    if (TENANT_TABLES.has(table)) {
      // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
      return (qb as any).where(`${alias}.church_id`, "=", this.#churchId)
    }
    return qb
    // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
  }) as any

  insertInto<TB extends keyof Database & string>(
    table: TB,
  ): Omit<InsertQueryBuilder<Database, TB, InsertResult>, "values"> & {
    values(
      insert: ScopedInsertable<TB> | ReadonlyArray<ScopedInsertable<TB>>,
    ): InsertQueryBuilder<Database, TB, InsertResult>
  } {
    const inner = this.#db.insertInto(table)
    if (!TENANT_TABLES.has(table)) {
      // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
      return inner as any
    }
    const churchId = this.#churchId
    return new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === "values") {
          return (insert: unknown) => {
            if (typeof insert === "function") {
              throw new Error(
                "ScopedDb: callback-style inserts are not supported for tenant tables",
              )
            }
            const items = Array.isArray(insert) ? insert : [insert]
            const merged = items.map((row: Record<string, unknown>) => {
              if ("church_id" in row && row.church_id !== churchId) {
                throw new Error("ScopedDb: cannot insert with a conflicting church_id")
              }
              return { ...row, church_id: churchId }
            })
            // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
            return (target as any).values(Array.isArray(insert) ? merged : merged[0])
          }
        }
        const val = Reflect.get(target, prop, receiver)
        return typeof val === "function" ? val.bind(target) : val
      },
      // biome-ignore lint/suspicious/noExplicitAny: Kysely type-erasure bridge — wrapper re-casts to preserve the underlying overloads
    }) as any
  }
}

export function createScopedDb(db: Kysely<Database>, churchId: string): ScopedDb {
  return new ScopedDb(db, churchId)
}
