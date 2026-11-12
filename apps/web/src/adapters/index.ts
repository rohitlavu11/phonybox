import type { AdapterDefinition, PlannedAdapter } from "./define"
import { mailgun } from "./mailgun"
import { telnyx } from "./telnyx"

/** Installed adapters. Register a new one here and every screen picks it up. */
export const adapters: AdapterDefinition[] = [mailgun, telnyx]

export const plannedAdapters: PlannedAdapter[] = [
  { id: "smtp", name: "SMTP", monogram: "Sm", channels: ["email"] },
  { id: "sendgrid", name: "SendGrid", monogram: "Sg", channels: ["email"] },
  { id: "postmark", name: "Postmark", monogram: "Pm", channels: ["email"] },
  { id: "ses", name: "Amazon SES", monogram: "Se", channels: ["email"] },
  { id: "twilio", name: "Twilio", monogram: "Tw", channels: ["sms"] },
  { id: "vonage", name: "Vonage", monogram: "Vo", channels: ["sms"] },
]

export function getAdapter(id: string): AdapterDefinition | undefined {
  return adapters.find((a) => a.id === id)
}

export function adapterBaseUrl(a: AdapterDefinition, host = "127.0.0.1") {
  return `http://${host}:${a.port}${a.apiPrefix}`
}

export type { AdapterDefinition, PlannedAdapter } from "./define"
