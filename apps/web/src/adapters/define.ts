import type { ChannelId } from "@/types/domain"

/**
 * An adapter makes the emulator look like one provider.
 *
 *  - outbound: the slice of the provider's REST API your app calls. Requests are
 *    accepted, recorded, and turned into messages in the matching inbox.
 *  - inbound:  the webhooks the provider would send to your app. They fire when
 *    someone sends from an inbox, or when a delivery status changes.
 *
 * The UI only reads this manifest. Adding a provider means adding a manifest
 * (and, on the server side, its route handlers). No screen has to change.
 */

export type Support = "full" | "partial" | "planned"

export interface EndpointSpec {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  path: string
  summary: string
  channel: ChannelId
  support: Support
}

export interface InboundEventSpec {
  event: string
  channel: ChannelId
  /** What makes the emulator send it. */
  trigger: string
  /** Setting key that holds the target URL. */
  urlSetting: string
}

export interface SettingSpec {
  key: string
  label: string
  description?: string
  kind: "url" | "text" | "secret" | "select" | "toggle"
  options?: string[]
  defaultValue: string | boolean
  group: "inbound" | "outbound" | "auth"
}

export interface ConnectSnippet {
  label: string
  language: "dotenv" | "ts" | "shell"
  code: string
}

export interface AdapterDefinition {
  id: string
  name: string
  /** Two-letter mark shown instead of the vendor's logo. */
  monogram: string
  description: string
  channels: ChannelId[]
  /** Each adapter listens on its own port so SDK base URLs stay unmodified. */
  port: number
  /** Path the provider's SDK expects after the host, e.g. "/v2". */
  apiPrefix: string
  version: string
  docsUrl: string
  outbound: EndpointSpec[]
  inbound: InboundEventSpec[]
  settings: SettingSpec[]
  connect: ConnectSnippet[]
}

export function defineAdapter(def: AdapterDefinition): AdapterDefinition {
  return def
}

/** A provider that has no adapter yet. Shown so the roadmap is visible. */
export interface PlannedAdapter {
  id: string
  name: string
  monogram: string
  channels: ChannelId[]
}
