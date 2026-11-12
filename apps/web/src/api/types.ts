import type { ChannelId, Direction, Inbox, SmsMessage } from "@/types/domain"

/**
 * Shapes of the control API. The UI never holds "all inboxes" or "all
 * messages": it asks for one page at a time, and search, filtering and
 * sorting happen on the server side. That keeps every screen O(page size)
 * whether there are 10 inboxes or 100,000.
 */

export interface Page<T> {
  items: T[]
  /** Total rows matching the query, across all pages. */
  total: number
  /** Opaque cursor for the next page, or null at the end. */
  nextCursor: number | null
}

export interface Cursor {
  cursor?: number
  limit?: number
}

export type InboxSort = "activity" | "unread" | "name" | "created"
export type InboxFilter = "all" | "unread" | "pinned" | "failing" | "idle"

export interface InboxQuery extends Cursor {
  channel?: ChannelId
  /** Matches address, label and tags. `tag:run:1042` matches a tag prefix. */
  q?: string
  filter?: InboxFilter
  sort?: InboxSort
}

/** Counters kept up to date by the server, so lists never scan messages. */
export interface InboxStats {
  messageCount: number
  unreadCount: number
  lastActivityAt: string | null
  /** Webhook chains whose latest attempt failed. */
  failing: number
}

export type InboxSummary = Inbox & InboxStats

export interface ItemQuery extends Cursor {
  channel: ChannelId
  /** Omit for the "all inboxes" stream. */
  inboxId?: string
  direction?: Direction
  q?: string
}

export interface Conversation {
  key: string
  inboxId: string
  inboxAddress: string
  inboxLabel?: string
  appNumber: string
  last: SmsMessage
  count: number
  unread: number
}

export interface ConversationQuery extends Cursor {
  inboxId?: string
  q?: string
}

export interface WebhookQuery extends Cursor {
  adapterId?: string
  failedOnly?: boolean
  q?: string
}

export interface RequestQuery extends Cursor {
  adapterId?: string
  q?: string
}

export interface ChannelStats {
  channel: ChannelId
  inboxes: number
  unread: number
  items: number
}

export interface WebhookTarget {
  url: string
  adapterId: string
  total: number
  failed: number
  lastStatus: number | null
}

/**
 * Bulk operations take either explicit ids or "everything matching this
 * query, except these". The second form is what makes "select all 2,400
 * matching" work without shipping 2,400 ids to the client.
 */
export type Selection =
  | { ids: string[] }
  | { query: Omit<InboxQuery, "cursor" | "limit">; except: string[] }

export type Dataset = "empty" | "small" | "large"

export interface NewInbox {
  channel: ChannelId
  address: string
  label?: string
  adapterId: string
  tags?: string[]
}

/** Per-adapter switch and settings, as stored by the server. */
export interface AdapterState {
  enabled: boolean
  values: Record<string, string | boolean>
}
