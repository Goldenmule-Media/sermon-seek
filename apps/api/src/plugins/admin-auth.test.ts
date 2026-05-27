import Fastify from "fastify"
import fp from "fastify-plugin"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../config.js", () => ({
  config: { ADMIN_API_KEY: "test-key-abc" },
}))

const { adminAuthPlugin } = await import("./admin-auth.js")

async function buildTestApp() {
  const app = Fastify()
  await app.register(adminAuthPlugin)
  app.get("/probe", { preHandler: app.requireAdminApiKey }, async () => ({ ok: true }))
  await app.ready()
  return app
}

describe("requireAdminApiKey middleware", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  afterEach(async () => {
    await app?.close()
  })

  it("returns 401 when x-admin-key header is missing", async () => {
    app = await buildTestApp()
    const res = await app.inject({ method: "GET", url: "/probe" })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ error: "invalid admin key" })
  })

  it("returns 401 when x-admin-key is wrong", async () => {
    app = await buildTestApp()
    const res = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-admin-key": "wrong-key" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 200 when x-admin-key matches ADMIN_API_KEY", async () => {
    app = await buildTestApp()
    const res = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-admin-key": "test-key-abc" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })
})

// ── requireAdminOrApiKey ────────────────────────────────────────────────────

type AuditInsert = {
  user_id: string | null
  action: string
  target_type: string
  target_id: string
  payload: unknown
}

async function buildComboApp(
  userOverride?: { id: string; is_admin: boolean } | null,
  auditCapture?: AuditInsert[],
) {
  const capturedRows: AuditInsert[] = auditCapture ?? []
  const stubDb = {
    insertInto: (_table: string) => ({
      values: (row: AuditInsert) => ({
        execute: async () => {
          capturedRows.push(row)
        },
      }),
    }),
  }

  const app = Fastify()
  // register a stub db plugin so app.db is available
  await app.register(
    fp(
      async (instance) => {
        instance.decorate("db", stubDb)
      },
      { name: "db" },
    ),
  )
  // simulate session plugin: set request.user
  app.decorateRequest("user", null)
  app.decorateRequest("sessionId", null)
  if (userOverride !== undefined) {
    app.addHook("onRequest", async (req) => {
      // @ts-expect-error test scaffold
      req.user = userOverride
    })
  }
  await app.register(adminAuthPlugin)
  app.get("/probe", { preHandler: app.requireAdminOrApiKey }, async () => ({ ok: true }))
  await app.ready()
  return { app, capturedRows }
}

describe("requireAdminOrApiKey middleware", () => {
  let app: Fastify.FastifyInstance

  afterEach(async () => {
    await app?.close()
  })

  it("returns 401 when no session and no api key", async () => {
    const { app: a } = await buildComboApp(null)
    app = a
    const res = await app.inject({ method: "GET", url: "/probe" })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ error: "unauthenticated" })
  })

  it("returns 200 when x-admin-key matches ADMIN_API_KEY", async () => {
    const { app: a } = await buildComboApp(null)
    app = a
    const res = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-admin-key": "test-key-abc" },
    })
    expect(res.statusCode).toBe(200)
  })

  it("returns 200 when request.user.is_admin is true", async () => {
    const { app: a } = await buildComboApp({ id: "user-1", is_admin: true })
    app = a
    const res = await app.inject({ method: "GET", url: "/probe" })
    expect(res.statusCode).toBe(200)
  })

  it("returns 403 and writes audit row when signed-in user is not admin", async () => {
    const capturedRows: AuditInsert[] = []
    const { app: a } = await buildComboApp({ id: "user-2", is_admin: false }, capturedRows)
    app = a
    const res = await app.inject({ method: "GET", url: "/probe" })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: "forbidden" })
    // Wait a tick for the fire-and-forget audit write
    await new Promise((r) => setTimeout(r, 10))
    expect(capturedRows).toHaveLength(1)
    expect(capturedRows[0]).toMatchObject({
      action: "admin.access.denied",
      target_type: "user",
      target_id: "user-2",
    })
  })
})
