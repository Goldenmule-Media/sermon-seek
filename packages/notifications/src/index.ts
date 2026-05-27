export type { EmailMessage, EmailSender, NotificationConfig, SmtpConfig } from "./sender.js"
export {
  createEmailSender,
  createLogSender,
  createSmtpSender,
  loadConfigFromEnv,
} from "./sender.js"
export type { NotifyContext } from "./notify.js"
export { notify } from "./notify.js"
export type { RenderedEmail, TemplateContext, TemplateName } from "./templates.js"
export { ADMIN_NOTIFY_STATUSES, renderTemplate } from "./templates.js"
