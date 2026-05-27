import nodemailer from "nodemailer"

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>
}

export interface SmtpConfig {
  host: string
  port: number
  user?: string
  pass?: string
  secure?: boolean
}

export interface NotificationConfig {
  smtp?: SmtpConfig
  from: string
  adminEmail?: string
}

export function createSmtpSender(config: NotificationConfig & { smtp: SmtpConfig }): EmailSender {
  const { from, smtp } = config
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure ?? false,
    ...(smtp.user && smtp.pass ? { auth: { user: smtp.user, pass: smtp.pass } } : {}),
  })

  return {
    async send(message: EmailMessage): Promise<void> {
      await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      })
    },
  }
}

export function createLogSender(opts?: {
  logger?: (line: string) => void
  from?: string
}): EmailSender {
  const log = opts?.logger ?? ((line: string) => console.info(line))
  const from = opts?.from ?? "no-reply@sermonseek.ai"

  return {
    async send(message: EmailMessage): Promise<void> {
      log(`[notifications] to=${message.to} subject="${message.subject}" from=${from}`)
      log(message.text)
    },
  }
}

export function createEmailSender(config: NotificationConfig): EmailSender {
  if (config.smtp?.host) {
    return createSmtpSender(config as NotificationConfig & { smtp: SmtpConfig })
  }
  return createLogSender({ from: config.from })
}

export function loadConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): NotificationConfig {
  const host = env.SMTP_HOST
  const from = env.SMTP_FROM ?? "no-reply@sermonseek.ai"
  const adminEmail = env.ADMIN_EMAIL

  if (!host) {
    return { from, ...(adminEmail ? { adminEmail } : {}) }
  }

  return {
    from,
    ...(adminEmail ? { adminEmail } : {}),
    smtp: {
      host,
      port: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      secure: env.SMTP_SECURE === "true",
    },
  }
}
