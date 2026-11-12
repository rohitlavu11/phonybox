/**
 * Domain model shared by every channel and adapter.
 *
 * Direction is always described from the point of view of the app under test:
 *   - "outbound": the app called the provider API (e.g. POST /v3/:domain/messages).
 *     The emulator accepts it and drops the message into the matching inbox.
 *   - "inbound":  someone in an inbox sent something *to* the app. The emulator
 *     delivers it as the provider's webhook (Mailgun route, Telnyx message.received…).
 */

export type ChannelId = "email" | "sms" | "fax"
export type Direction = "outbound" | "inbound"

export type DeliveryStatus =
  "queued" | "sending" | "delivered" | "failed" | "bounced" | "received"

export interface Inbox {
  id: string
  channel: ChannelId
  /** Email address, or E.164 number for phone-based channels. */
  address: string
  label?: string
  /** Adapter used when this inbox sends something to the app. */
  adapterId: string
  /** Catch-all inboxes capture anything not addressed to another inbox. */
  catchAll?: boolean
  /** Free-form "key:value" tags, e.g. suite:checkout, run:1042. Searchable with tag:… */
  tags: string[]
  /** Shown in the sidebar. */
  pinned?: boolean
  /** Who made it. Agent-created inboxes are what retention rules clean up. */
  createdBy: "seed" | "ui" | "agent" | "auto"
  createdAt: string
}

export interface Address {
  name?: string
  address: string
}

export interface Attachment {
  filename: string
  contentType: string
  size: number
}

export interface EmailMessage {
  id: string
  channel: "email"
  inboxId: string
  adapterId: string
  direction: Direction
  messageId: string
  from: Address
  to: Address[]
  cc?: Address[]
  subject: string
  text: string
  html?: string
  attachments: Attachment[]
  headers: [string, string][]
  tags: string[]
  status: DeliveryStatus
  read: boolean
  createdAt: string
}

export interface SmsMessage {
  id: string
  channel: "sms"
  inboxId: string
  adapterId: string
  direction: Direction
  /** Provider-side id, e.g. Telnyx message uuid. */
  providerId: string
  /** The app's number (sender for outbound, recipient for inbound). */
  appNumber: string
  /** The inbox's number. */
  peerNumber: string
  body: string
  media: Attachment[]
  parts: number
  status: DeliveryStatus
  read: boolean
  createdAt: string
  /** System notes rendered inside the thread (opt-out, carrier errors…). */
  note?: string
}

export interface FaxEvent {
  event: string
  at: string
}

export interface FaxDocument {
  id: string
  channel: "fax"
  inboxId: string
  adapterId: string
  direction: Direction
  providerId: string
  appNumber: string
  peerNumber: string
  title: string
  pages: number
  quality: "normal" | "high" | "very_high"
  status: DeliveryStatus
  failureReason?: string
  events: FaxEvent[]
  read: boolean
  createdAt: string
}

export type ChannelItem = EmailMessage | SmsMessage | FaxDocument

export interface WebhookDelivery {
  id: string
  adapterId: string
  channel: ChannelId
  event: string
  url: string
  /** null = connection refused / timed out. */
  status: number | null
  durationMs: number
  attempt: number
  maxAttempts: number
  createdAt: string
  relatedId?: string
  requestHeaders: [string, string][]
  requestBody: string
  responseBody?: string
  error?: string
}

export interface ApiRequest {
  id: string
  adapterId: string
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  path: string
  status: number
  durationMs: number
  createdAt: string
  relatedId?: string
  requestBody?: string
  responseBody?: string
}
