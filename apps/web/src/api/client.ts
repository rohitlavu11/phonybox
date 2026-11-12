/**
 * The control API as the UI sees it. Two transports, one interface:
 *
 *   http    (default) talks to the Python server: /api/* and the SSE feed.
 *   memory  (VITE_API=memory) runs the in-browser mock, for UI work without a server.
 *
 * Shapes are defined by contracts/control-api.openapi.json and
 * checked against these types by `pnpm contract`.
 */
import type {
  ApiRequest,
  ChannelId,
  ChannelItem,
  EmailMessage,
  FaxDocument,
  Inbox,
  SmsMessage,
  WebhookDelivery,
} from "@/types/domain"
import { getDb } from "@/mocks/db"
import type {
  AdapterState,
  ChannelStats,
  Conversation,
  ConversationQuery,
  Dataset,
  InboxQuery,
  InboxSummary,
  ItemQuery,
  NewInbox,
  Page,
  RequestQuery,
  Selection,
  WebhookQuery,
  WebhookTarget,
} from "./types"

export const transport: "http" | "memory" =
  import.meta.env.VITE_API === "memory" ? "memory" : "http"
export const isMemory = transport === "memory"

type SendEmail = { inbox: Inbox; to: string; subject: string; text: string }
type SendSms = { inbox: Inbox; appNumber: string; body: string }
type SendFax = { inbox: Inbox; appNumber: string; title: string; pages: number }

export interface Api {
  listInboxes(q: InboxQuery): Promise<Page<InboxSummary>>
  getInbox(idOrAddress: string): Promise<InboxSummary | null>
  pinned(): Promise<InboxSummary[]>
  channelStats(): Promise<ChannelStats[]>
  createInboxes(list: NewInbox[]): Promise<Inbox[]>
  deleteInboxes(sel: Selection): Promise<number>
  clearInboxes(sel: Selection): Promise<number>
  markInboxesRead(sel: Selection): Promise<number>
  setPinned(ids: string[], pinned: boolean): Promise<void>

  listItems(q: ItemQuery): Promise<Page<ChannelItem>>
  getItem(id: string): Promise<ChannelItem | null>
  setItemsRead(ids: string[], read: boolean): Promise<void>
  deleteItem(id: string): Promise<void>
  listConversations(q: ConversationQuery): Promise<Page<Conversation>>
  thread(inboxId: string, appNumber: string): Promise<SmsMessage[]>
  sendEmailToApp(input: SendEmail): Promise<EmailMessage>
  sendSmsToApp(input: SendSms): Promise<SmsMessage>
  sendFaxToApp(input: SendFax): Promise<FaxDocument>

  listWebhooks(q: WebhookQuery): Promise<Page<WebhookDelivery>>
  getWebhook(id: string): Promise<WebhookDelivery | null>
  webhooksFor(itemId: string): Promise<WebhookDelivery[]>
  webhookTargets(): Promise<WebhookTarget[]>
  latestWebhook(): Promise<WebhookDelivery | null>
  failingCount(): Promise<number>
  replayWebhook(id: string): Promise<void>
  listRequests(q: RequestQuery): Promise<Page<ApiRequest>>
  getRequest(id: string): Promise<ApiRequest | null>
  requestFor(itemId: string): Promise<ApiRequest | null>

  adapters(): Promise<Record<string, AdapterState>>
  setAdapter(id: string, patch: Partial<AdapterState>): Promise<void>
  setAdapterValue(
    id: string,
    key: string,
    value: string | boolean
  ): Promise<void>
  reset(dataset?: Dataset): Promise<void>
  dataset(): Promise<Dataset>
}

/* ------------------------------------------------------------------ http */

export class ApiError extends Error {
  readonly status: number
  readonly body: string
  constructor(status: number, body: string) {
    super(`${status}: ${body.slice(0, 200)}`)
    this.status = status
    this.body = body
  }
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-phonybox-client": "ui",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return (res.status === 204 ? undefined : await res.json()) as T
}

const get = <T>(path: string) => call<T>("GET", path)
const orNull = <T>(p: Promise<T>): Promise<T | null> =>
  p.catch((e: unknown) =>
    e instanceof ApiError && e.status === 404 ? null : Promise.reject(e)
  )

function qs(
  params: Record<string, string | number | boolean | undefined | null>
) {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== "" && v !== false)
      s.set(k, String(v))
  const out = s.toString()
  return out ? `?${out}` : ""
}

const enc = encodeURIComponent
const bulk = (op: string, sel: Selection) =>
  call<{ affected: number }>("POST", "/api/inboxes/bulk", { op, ...sel }).then(
    (r) => r.affected
  )

const http: Api = {
  listInboxes: (q) =>
    get(
      `/api/inboxes${qs({ channel: q.channel, q: q.q, filter: q.filter, sort: q.sort, cursor: q.cursor, limit: q.limit })}`
    ),
  getInbox: (key) => orNull(get(`/api/inboxes/${enc(key)}`)),
  pinned: () =>
    get<Page<InboxSummary>>("/api/inboxes?filter=pinned&limit=500").then(
      (p) => p.items
    ),
  channelStats: () => get("/api/stats"),
  createInboxes: (list) => call("POST", "/api/inboxes", list),
  deleteInboxes: (sel) => bulk("delete", sel),
  clearInboxes: (sel) => bulk("clear", sel),
  markInboxesRead: (sel) => bulk("read", sel),
  setPinned: (ids, pinned) =>
    bulk(pinned ? "pin" : "unpin", { ids }).then(() => undefined),

  listItems: (q) =>
    get(
      `/api/items${qs({ channel: q.channel, inbox: q.inboxId, direction: q.direction, q: q.q, cursor: q.cursor, limit: q.limit })}`
    ),
  getItem: (id) => orNull(get(`/api/items/${enc(id)}`)),
  setItemsRead: (ids, read) =>
    call<unknown>("PATCH", "/api/items", { ids, read }).then(() => undefined),
  deleteItem: (id) =>
    call<unknown>("DELETE", `/api/items/${enc(id)}`).then(() => undefined),
  listConversations: (q) =>
    get(
      `/api/sms/conversations${qs({ inbox: q.inboxId, q: q.q, cursor: q.cursor, limit: q.limit })}`
    ),
  thread: (inboxId, appNumber) =>
    get(`/api/sms/conversations/${enc(inboxId)}/${enc(appNumber)}`),
  sendEmailToApp: ({ inbox, ...body }) =>
    call("POST", `/api/inboxes/${enc(inbox.id)}/send`, body),
  sendSmsToApp: ({ inbox, ...body }) =>
    call("POST", `/api/inboxes/${enc(inbox.id)}/send`, body),
  sendFaxToApp: ({ inbox, ...body }) =>
    call("POST", `/api/inboxes/${enc(inbox.id)}/send`, body),

  listWebhooks: (q) =>
    get(
      `/api/webhooks${qs({ adapter: q.adapterId, failed: q.failedOnly, q: q.q, cursor: q.cursor, limit: q.limit })}`
    ),
  getWebhook: (id) => orNull(get(`/api/webhooks/${enc(id)}`)),
  webhooksFor: (itemId) => get(`/api/items/${enc(itemId)}/webhooks`),
  webhookTargets: () => get("/api/webhooks/targets"),
  latestWebhook: () => get("/api/webhooks/latest"),
  failingCount: () =>
    get<{ count: number }>("/api/webhooks/failing").then((r) => r.count),
  replayWebhook: (id) =>
    call<unknown>("POST", `/api/webhooks/${enc(id)}/replay`).then(
      () => undefined
    ),
  listRequests: (q) =>
    get(
      `/api/requests${qs({ adapter: q.adapterId, q: q.q, cursor: q.cursor, limit: q.limit })}`
    ),
  getRequest: (id) => orNull(get(`/api/requests/${enc(id)}`)),
  requestFor: (itemId) => get(`/api/items/${enc(itemId)}/request`),

  adapters: () => get("/api/adapters"),
  setAdapter: (id, patch) =>
    call<unknown>("PATCH", `/api/adapters/${enc(id)}`, patch).then(
      () => undefined
    ),
  setAdapterValue: (id, key, value) =>
    call<unknown>("PATCH", `/api/adapters/${enc(id)}`, {
      values: { [key]: value },
    }).then(() => undefined),
  reset: (dataset) =>
    call<unknown>("POST", "/api/reset", dataset ? { dataset } : {}).then(
      () => undefined
    ),
  dataset: () =>
    get<{ dataset: Dataset }>("/api/health").then((h) => h.dataset),
}

/* ---------------------------------------------------------------- memory */

const ok = <T>(value: T) => Promise.resolve(value)
const db = () => getDb()

const memory: Api = {
  listInboxes: (q) => ok(db().listInboxes(q)),
  getInbox: (key) => ok(db().getInbox(key)),
  pinned: () => ok(db().pinned()),
  channelStats: () => ok(db().channelStats()),
  createInboxes: (list) => ok(db().createInboxes(list)),
  deleteInboxes: (sel) => ok(db().deleteInboxes(sel)),
  clearInboxes: (sel) => ok(db().clearInboxes(sel)),
  markInboxesRead: (sel) => ok(db().markInboxesRead(sel)),
  setPinned: (ids, pinned) => ok(db().setPinned(ids, pinned)),
  listItems: (q) => ok(db().listItems(q)),
  getItem: (id) => ok(db().getItem(id)),
  setItemsRead: (ids, read) => ok(db().setItemsRead(ids, read)),
  deleteItem: (id) => ok(db().deleteItem(id)),
  listConversations: (q) => ok(db().listConversations(q)),
  thread: (inboxId, appNumber) => ok(db().thread(inboxId, appNumber)),
  sendEmailToApp: (input) => ok(db().sendEmailToApp(input)),
  sendSmsToApp: (input) => ok(db().sendSmsToApp(input)),
  sendFaxToApp: (input) => ok(db().sendFaxToApp(input)),
  listWebhooks: (q) => ok(db().listWebhooks(q)),
  getWebhook: (id) => ok(db().getWebhook(id)),
  webhooksFor: (itemId) => ok(db().webhooksFor(itemId)),
  webhookTargets: () => ok(db().webhookTargets()),
  latestWebhook: () => ok(db().latestWebhook()),
  failingCount: () => ok(db().failingCount()),
  replayWebhook: (id) => ok(db().replayWebhook(id)),
  listRequests: (q) => ok(db().listRequests(q)),
  getRequest: (id) => ok(db().getRequest(id)),
  requestFor: (itemId) => ok(db().requestFor(itemId)),
  adapters: () => ok(db().getAdapters()),
  setAdapter: (id, patch) => ok(db().setAdapter(id, patch)),
  setAdapterValue: (id, key, value) => ok(db().setAdapterValue(id, key, value)),
  reset: (dataset) =>
    ok(db().load(dataset === "empty" ? "small" : (dataset ?? db().dataset))),
  dataset: () => ok(db().dataset),
}

export const api: Api = isMemory ? memory : http

export type { ChannelId }
