import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../config.js", () => ({
  config: { ADMIN_API_KEY: "test-key-abc" },
}))

const { adminAuthPlugin } = await import("./admin-auth.js")

async function buildTestApp() {
  const app = Fastify()
  await app.register(adminAuthPlugin)
  app.get("/probe", { preHandler: app.requireAdmin }, async () => ({ ok: true }))
  await app.ready()
  return app
}

describe("requireAdmin middleware", () => {
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
