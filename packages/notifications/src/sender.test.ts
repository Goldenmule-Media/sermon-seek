import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createEmailSender,
  createLogSender,
  createSmtpSender,
  loadConfigFromEnv,
} from "./sender.js"

const { mockSendMail, mockCreateTransport } = vi.hoisted(() => {
  const mockSendMail = vi.fn()
  const mockCreateTransport = vi.fn(() => ({ sendMail: mockSendMail }))
  return { mockSendMail, mockCreateTransport }
})

vi.mock("nodemailer", () => ({
  default: { createTransport: mockCreateTransport },
}))

describe("createLogSender", () => {
  it("logs structured line and body text to the injected logger", async () => {
    const lines: string[] = []
    const sender = createLogSender({ logger: (l) => lines.push(l), from: "test@example.com" })
    await sender.send({ to: "user@example.com", subject: "Hello World", text: "body text" })
    expect(lines[0]).toContain("to=user@example.com")
    expect(lines[0]).toContain('subject="Hello World"')
    expect(lines[0]).toContain("from=test@example.com")
    expect(lines[1]).toContain("body text")
  })

  it("falls back to console.info when no logger provided", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {})
    const sender = createLogSender()
    await sender.send({ to: "a@b.com", subject: "s", text: "t" })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe("createSmtpSender", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("passes host, port, and secure to createTransport", async () => {
    const sender = createSmtpSender({
      from: "from@example.com",
      smtp: { host: "smtp.example.com", port: 465, secure: true },
    })
    await sender.send({ to: "to@example.com", subject: "sub", text: "body" })
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.example.com", port: 465, secure: true }),
    )
  })

  it("includes auth when user and pass are provided", async () => {
    createSmtpSender({
      from: "from@example.com",
      smtp: { host: "smtp.example.com", port: 587, user: "u", pass: "p" },
    })
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: "u", pass: "p" } }),
    )
  })

  it("omits auth when user and pass are absent", async () => {
    createSmtpSender({
      from: "from@example.com",
      smtp: { host: "smtp.example.com", port: 587 },
    })
    const call = mockCreateTransport.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call).not.toHaveProperty("auth")
  })

  it("forwards from, to, subject, text, html to sendMail exactly once", async () => {
    mockSendMail.mockResolvedValueOnce({})
    const sender = createSmtpSender({
      from: "from@example.com",
      smtp: { host: "smtp.example.com", port: 587 },
    })
    await sender.send({
      to: "to@example.com",
      subject: "Test subject",
      text: "plain text",
      html: "<p>html</p>",
    })
    expect(mockSendMail).toHaveBeenCalledTimes(1)
    expect(mockSendMail).toHaveBeenCalledWith({
      from: "from@example.com",
      to: "to@example.com",
      subject: "Test subject",
      text: "plain text",
      html: "<p>html</p>",
    })
  })
})

describe("createEmailSender", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns log sender (no createTransport) when smtp is absent", async () => {
    const lines: string[] = []
    const sender = createEmailSender({ from: "from@example.com" })
    await sender.send({ to: "x@x.com", subject: "s", text: "t" })
    expect(mockCreateTransport).not.toHaveBeenCalled()
    void lines
  })

  it("returns SMTP sender (createTransport called) when smtp.host is present", () => {
    createEmailSender({
      from: "from@example.com",
      smtp: { host: "smtp.example.com", port: 587 },
    })
    expect(mockCreateTransport).toHaveBeenCalledTimes(1)
  })
})

describe("loadConfigFromEnv", () => {
  it("returns log-only config when SMTP_HOST is absent", () => {
    const config = loadConfigFromEnv({})
    expect(config.smtp).toBeUndefined()
    expect(config.from).toBe("no-reply@sermonseek.ai")
  })

  it("defaults SMTP_PORT to 587 and SMTP_FROM to no-reply@sermonseek.ai", () => {
    const config = loadConfigFromEnv({ SMTP_HOST: "smtp.example.com" })
    expect(config.smtp?.port).toBe(587)
    expect(config.from).toBe("no-reply@sermonseek.ai")
  })

  it("returns full SMTP config from a complete SMTP_* block", () => {
    const config = loadConfigFromEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_USER: "user",
      SMTP_PASS: "pass",
      SMTP_SECURE: "true",
      SMTP_FROM: "hello@example.com",
      ADMIN_EMAIL: "admin@example.com",
    })
    expect(config.smtp).toEqual({
      host: "smtp.example.com",
      port: 465,
      user: "user",
      pass: "pass",
      secure: true,
    })
    expect(config.from).toBe("hello@example.com")
    expect(config.adminEmail).toBe("admin@example.com")
  })

  it("omits adminEmail when ADMIN_EMAIL is absent", () => {
    const config = loadConfigFromEnv({ SMTP_HOST: "smtp.example.com" })
    expect(config.adminEmail).toBeUndefined()
  })
})
