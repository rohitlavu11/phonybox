/**
 * In-memory stand-in for the emulator's store. It is shaped like the real
 * server's: id indexes instead of arrays of objects, counters maintained on
 * write (so listing 5,000 inboxes never touches their messages), heavy fields
 * rendered on first read, and a change feed the UI subscribes to (on the real
 * server this becomes GET /api/events over SSE).
 */
import { adapters } from "@/adapters"
import { NOW } from "@/lib/format"
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
import { buildWebhook, uuid } from "@/mocks/payloads"
import {
  seedEmails,
  seedFaxes,
  seedInboxes,
  seedRequests,
  seedSms,
  seedWebhooks,
} from "@/mocks/seed"
import { generate } from "./generate"
import type {
  AdapterState,
  ChannelStats,
  Conversation,
  ConversationQuery,
  Dataset,
  InboxQuery,
  InboxStats,
  InboxSummary,
  ItemQuery,
  NewInbox,
  Page,
  RequestQuery,
  Selection,
  WebhookQuery,
  WebhookTarget,
} from "@/api/types"

export type Topic = "inboxes" | "items" | "webhooks" | "requests" | "adapters"
type Listener = (topics: Set<Topic>) => void

const CHANNELS: ChannelId[] = ["email", "sms", "fax"]
const PAGE = 100
const isFail = (s: number | null) => s === null || s >= 400
const byNewest = (a: { createdAt: string }, b: { createdAt: string }) =>
  b.createdAt.localeCompare(a.createdAt)

function page<T>(all: T[], cursor = 0, limit = PAGE): Page<T> {
  const items = all.slice(cursor, cursor + limit)
  const next = cursor + items.length
  return {
    items,
    total: all.length,
    nextCursor: next < all.length ? next : null,
  }
}

function haystack(item: ChannelItem) {
  if (item.channel === "email")
    return [
      item.subject,
      item.from.address,
      item.from.name ?? "",
      ...item.to.map((t) => t.address),
      item.text.slice(0, 400),
    ]
      .join(" ")
      .toLowerCase()
  if (item.channel === "sms")
    return `${item.body} ${item.appNumber} ${item.peerNumber}`.toLowerCase()
  return `${item.title} ${item.appNumber} ${item.peerNumber}`.toLowerCase()
}

class LocalDB {
  dataset: Dataset = "large"

  private inboxes = new Map<string, Inbox>()
  private inboxIds: Record<ChannelId, string[]> = {
    email: [],
    sms: [],
    fax: [],
  }
  private stats = new Map<string, InboxStats>()
  private addressIndex = new Map<string, string>()

  private items = new Map<string, ChannelItem>()
  private itemIds: Record<ChannelId, string[]> = { email: [], sms: [], fax: [] }
  private byInbox = new Map<string, string[]>()
  private lazy = new Map<string, (item: ChannelItem) => Partial<ChannelItem>>()

  private webhooks = new Map<string, WebhookDelivery>()
  private webhookIds: string[] = []
  private webhooksByItem = new Map<string, string[]>()
  /** Latest status per (item, event) chain, and how many chains per item are failing. */
  private chain = new Map<string, number | null>()
  private itemFailing = new Map<string, number>()
  private failingTotal = 0

  private requests = new Map<string, ApiRequest>()
  private requestIds: string[] = []
  private requestByItem = new Map<string, string>()

  private adapterState: Record<string, AdapterState> = {}
  private memo = new Map<string, unknown>()
  private listeners = new Set<Listener>()
  version = 0

  constructor() {
    this.load("large")
  }

  /* ----------------------------------------------------------- events */

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private emit(...topics: Topic[]) {
    this.version++
    this.memo.clear()
    const set = new Set(topics)
    this.listeners.forEach((l) => l(set))
  }

  /** Cache derived lists until the next write. */
  private cached<T>(key: string, build: () => T): T {
    if (!this.memo.has(key)) this.memo.set(key, build())
    return this.memo.get(key) as T
  }

  /* ------------------------------------------------------------- load */

  load(dataset: Dataset) {
    this.dataset = dataset
    for (const m of [
      this.inboxes,
      this.stats,
      this.addressIndex,
      this.items,
      this.byInbox,
      this.lazy,
      this.webhooks,
      this.webhooksByItem,
      this.chain,
      this.itemFailing,
      this.requests,
      this.requestByItem,
    ])
      m.clear()
    this.inboxIds = { email: [], sms: [], fax: [] }
    this.itemIds = { email: [], sms: [], fax: [] }
    this.webhookIds = []
    this.requestIds = []
    this.failingTotal = 0

    const gen = dataset === "large" ? generate() : null
    const inboxes = [...seedInboxes, ...(gen?.inboxes ?? [])]
    const items = [
      ...seedEmails,
      ...seedSms,
      ...seedFaxes,
      ...(gen?.items ?? []),
    ].sort(byNewest)
    const webhooks = [...seedWebhooks, ...(gen?.webhooks ?? [])].sort(byNewest)
    const requests = [...seedRequests, ...(gen?.requests ?? [])].sort(byNewest)
    gen?.lazy.forEach((fn, id) => this.lazy.set(id, fn))

    for (const inbox of inboxes) this.putInbox(inbox)
    for (const item of items) {
      this.items.set(item.id, item)
      this.itemIds[item.channel].push(item.id)
      this.byInbox.get(item.inboxId)?.push(item.id)
    }
    // Oldest first so the latest attempt per chain wins.
    for (const w of [...webhooks].reverse()) this.indexWebhook(w, false)
    this.webhookIds = webhooks.map((w) => w.id)
    for (const r of requests) {
      this.requests.set(r.id, r)
      this.requestIds.push(r.id)
      if (r.relatedId) this.requestByItem.set(r.relatedId, r.id)
    }
    for (const id of this.inboxes.keys()) this.recount(id)

    this.adapterState = Object.fromEntries(
      adapters.map((a) => [
        a.id,
        {
          enabled: true,
          values: Object.fromEntries(
            a.settings.map((s) => [s.key, s.defaultValue])
          ),
        },
      ])
    )
    this.emit("inboxes", "items", "webhooks", "requests", "adapters")
  }

  private putInbox(inbox: Inbox) {
    this.inboxes.set(inbox.id, inbox)
    this.inboxIds[inbox.channel].push(inbox.id)
    this.byInbox.set(inbox.id, [])
    this.addressIndex.set(`${inbox.channel}:${inbox.address}`, inbox.id)
  }

  private indexWebhook(w: WebhookDelivery, prepend = true) {
    this.webhooks.set(w.id, w)
    if (prepend) this.webhookIds.unshift(w.id)
    if (!w.relatedId) return
    const list = this.webhooksByItem.get(w.relatedId) ?? []
    list.push(w.id)
    this.webhooksByItem.set(w.relatedId, list)

    const key = `${w.relatedId}|${w.event}`
    const before = this.chain.has(key) ? isFail(this.chain.get(key)!) : false
    const after = isFail(w.status)
    this.chain.set(key, w.status)
    if (before !== after) {
      const d = after ? 1 : -1
      this.itemFailing.set(
        w.relatedId,
        (this.itemFailing.get(w.relatedId) ?? 0) + d
      )
      this.failingTotal += d
    }
  }

  /** Recompute one inbox's counters from its own items. O(messages in that inbox). */
  private recount(inboxId: string) {
    const ids = this.byInbox.get(inboxId) ?? []
    let unread = 0
    let failing = 0
    for (const id of ids) {
      const it = this.items.get(id)!
      if (!it.read) unread++
      failing += this.itemFailing.get(id) ?? 0
    }
    this.stats.set(inboxId, {
      messageCount: ids.length,
      unreadCount: unread,
      lastActivityAt: ids.length ? this.items.get(ids[0])!.createdAt : null,
      failing,
    })
  }

  /* ---------------------------------------------------------- inboxes */

  private summary(id: string): InboxSummary {
    return { ...this.inboxes.get(id)!, ...this.stats.get(id)! }
  }

  private matchIds(q: Omit<InboxQuery, "cursor" | "limit">): string[] {
    const key = `inboxes:${q.channel ?? "*"}:${q.q ?? ""}:${q.filter ?? "all"}:${q.sort ?? "activity"}`
    return this.cached(key, () => {
      const ids = q.channel
        ? this.inboxIds[q.channel]
        : CHANNELS.flatMap((c) => this.inboxIds[c])
      const terms = (q.q ?? "")
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
      const idle = NOW - 24 * 3600_000

      let rows = ids.map((id) => ({
        inbox: this.inboxes.get(id)!,
        stats: this.stats.get(id)!,
      }))
      if (terms.length) {
        rows = rows.filter(({ inbox }) => {
          const text = `${inbox.address} ${inbox.label ?? ""}`.toLowerCase()
          return terms.every((t) =>
            t.startsWith("tag:")
              ? inbox.tags.some((tag) => tag.startsWith(t.slice(4)))
              : text.includes(t)
          )
        })
      }
      switch (q.filter) {
        case "unread":
          rows = rows.filter((r) => r.stats.unreadCount > 0)
          break
        case "pinned":
          rows = rows.filter((r) => r.inbox.pinned)
          break
        case "failing":
          rows = rows.filter((r) => r.stats.failing > 0)
          break
        case "idle":
          rows = rows.filter(
            (r) =>
              Date.parse(r.stats.lastActivityAt ?? r.inbox.createdAt) < idle
          )
          break
      }
      const activity = (r: (typeof rows)[number]) =>
        r.stats.lastActivityAt ?? r.inbox.createdAt
      const name = (r: (typeof rows)[number]) =>
        (r.inbox.label ?? r.inbox.address).toLowerCase()
      switch (q.sort ?? "activity") {
        case "activity":
          rows.sort((a, b) => activity(b).localeCompare(activity(a)))
          break
        case "unread":
          rows.sort(
            (a, b) =>
              b.stats.unreadCount - a.stats.unreadCount ||
              activity(b).localeCompare(activity(a))
          )
          break
        case "name":
          rows.sort((a, b) =>
            name(a).localeCompare(name(b), undefined, { numeric: true })
          )
          break
        case "created":
          rows.sort((a, b) =>
            b.inbox.createdAt.localeCompare(a.inbox.createdAt)
          )
          break
      }
      return rows.map((r) => r.inbox.id)
    })
  }

  listInboxes(q: InboxQuery): Page<InboxSummary> {
    const p = page(this.matchIds(q), q.cursor, q.limit)
    return { ...p, items: (p.items as string[]).map((id) => this.summary(id)) }
  }

  /** Accepts an id or an address, so agents can use the email/number directly. */
  getInbox(idOrAddress: string): InboxSummary | null {
    const id = this.inboxes.has(idOrAddress)
      ? idOrAddress
      : CHANNELS.map((c) => this.addressIndex.get(`${c}:${idOrAddress}`)).find(
          Boolean
        )
    return id ? this.summary(id) : null
  }

  pinned(): InboxSummary[] {
    return this.cached("pinned", () =>
      CHANNELS.flatMap((c) =>
        this.inboxIds[c]
          .filter((id) => this.inboxes.get(id)!.pinned)
          .map((id) => this.summary(id))
      )
    )
  }

  channelStats(): ChannelStats[] {
    return this.cached("stats", () =>
      CHANNELS.map((channel) => {
        let unread = 0
        for (const id of this.inboxIds[channel])
          unread += this.stats.get(id)!.unreadCount
        return {
          channel,
          inboxes: this.inboxIds[channel].length,
          unread,
          items: this.itemIds[channel].length,
        }
      })
    )
  }

  private resolve(sel: Selection): string[] {
    if ("ids" in sel) return sel.ids.filter((id) => this.inboxes.has(id))
    const except = new Set(sel.except)
    return this.matchIds(sel.query).filter((id) => !except.has(id))
  }

  createInboxes(list: NewInbox[]): Inbox[] {
    const made: Inbox[] = []
    for (const n of list) {
      if (this.addressIndex.has(`${n.channel}:${n.address}`)) continue
      const id = n.address
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()
      const inbox: Inbox = {
        id: this.inboxes.has(id) ? `${id}-${uuid(id).slice(0, 4)}` : id,
        channel: n.channel,
        address: n.address,
        label: n.label,
        adapterId: n.adapterId,
        tags: n.tags ?? [],
        createdBy: "ui",
        createdAt: new Date().toISOString(),
      }
      this.putInbox(inbox)
      this.inboxIds[inbox.channel].pop()
      this.inboxIds[inbox.channel].unshift(inbox.id)
      this.recount(inbox.id)
      made.push(inbox)
    }
    if (made.length) this.emit("inboxes")
    return made
  }

  exists(channel: ChannelId, address: string) {
    return this.addressIndex.has(`${channel}:${address}`)
  }

  private dropItems(ids: Set<string>) {
    if (!ids.size) return
    for (const c of CHANNELS)
      this.itemIds[c] = this.itemIds[c].filter((id) => !ids.has(id))
    for (const id of ids) {
      this.failingTotal -= this.itemFailing.get(id) ?? 0
      this.itemFailing.delete(id)
      this.items.delete(id)
      this.lazy.delete(id)
    }
  }

  deleteInboxes(sel: Selection) {
    const targets = this.resolve(sel).filter(
      (id) => !this.inboxes.get(id)!.catchAll
    )
    const drop = new Set(targets.flatMap((id) => this.byInbox.get(id) ?? []))
    this.dropItems(drop)
    const gone = new Set(targets)
    for (const id of targets) {
      const inbox = this.inboxes.get(id)!
      this.addressIndex.delete(`${inbox.channel}:${inbox.address}`)
      this.inboxes.delete(id)
      this.stats.delete(id)
      this.byInbox.delete(id)
    }
    for (const c of CHANNELS)
      this.inboxIds[c] = this.inboxIds[c].filter((id) => !gone.has(id))
    this.emit("inboxes", "items")
    return targets.length
  }

  clearInboxes(sel: Selection) {
    const targets = this.resolve(sel)
    this.dropItems(new Set(targets.flatMap((id) => this.byInbox.get(id) ?? [])))
    for (const id of targets) {
      this.byInbox.set(id, [])
      this.recount(id)
    }
    this.emit("inboxes", "items")
    return targets.length
  }

  markInboxesRead(sel: Selection) {
    const targets = this.resolve(sel)
    for (const inboxId of targets) {
      for (const id of this.byInbox.get(inboxId) ?? []) {
        const it = this.items.get(id)!
        if (!it.read) this.items.set(id, { ...it, read: true })
      }
      this.recount(inboxId)
    }
    this.emit("inboxes", "items")
    return targets.length
  }

  setPinned(ids: string[], pinned: boolean) {
    for (const id of ids) {
      const inbox = this.inboxes.get(id)
      if (inbox) this.inboxes.set(id, { ...inbox, pinned })
    }
    this.emit("inboxes")
  }

  /* ------------------------------------------------------------ items */

  private matchItems(q: Omit<ItemQuery, "cursor" | "limit">): string[] {
    const key = `items:${q.channel}:${q.inboxId ?? "*"}:${q.direction ?? ""}:${q.q ?? ""}`
    return this.cached(key, () => {
      let ids = q.inboxId
        ? (this.byInbox.get(q.inboxId) ?? [])
        : this.itemIds[q.channel]
      if (q.direction)
        ids = ids.filter((id) => this.items.get(id)!.direction === q.direction)
      const text = q.q?.trim().toLowerCase()
      if (text)
        ids = ids.filter((id) => haystack(this.items.get(id)!).includes(text))
      return ids
    })
  }

  listItems(q: ItemQuery): Page<ChannelItem> {
    const p = page(this.matchItems(q), q.cursor, q.limit)
    return {
      ...p,
      items: (p.items as string[]).map((id) => this.items.get(id)!),
    }
  }

  /** Full item, with lazily rendered fields filled in. */
  getItem(id: string): ChannelItem | null {
    const item = this.items.get(id)
    if (!item) return null
    const fill = this.lazy.get(id)
    if (!fill) return item
    const full = { ...item, ...fill(item) } as ChannelItem
    this.items.set(id, full)
    this.lazy.delete(id)
    return full
  }

  private setItem(id: string, patch: Partial<ChannelItem>) {
    const it = this.items.get(id)
    if (!it) return
    this.items.set(id, { ...it, ...patch } as ChannelItem)
    this.recount(it.inboxId)
  }

  setItemsRead(ids: string[], read: boolean) {
    let changed = false
    for (const id of ids) {
      const it = this.items.get(id)
      if (it && it.read !== read) {
        this.setItem(id, { read })
        changed = true
      }
    }
    if (changed) this.emit("items", "inboxes")
  }

  deleteItem(id: string) {
    const it = this.items.get(id)
    if (!it) return
    this.dropItems(new Set([id]))
    this.byInbox.set(
      it.inboxId,
      (this.byInbox.get(it.inboxId) ?? []).filter((x) => x !== id)
    )
    this.recount(it.inboxId)
    this.emit("items", "inboxes")
  }

  listConversations(q: ConversationQuery): Page<Conversation> {
    const all = this.cached(`conv:${q.inboxId ?? "*"}:${q.q ?? ""}`, () => {
      const ids = q.inboxId
        ? (this.byInbox.get(q.inboxId) ?? [])
        : this.itemIds.sms
      const map = new Map<string, Conversation>()
      for (const id of ids) {
        const m = this.items.get(id) as SmsMessage
        const key = `${m.inboxId}|${m.appNumber}`
        const c = map.get(key)
        if (c) {
          c.count++
          if (!m.read) c.unread++
        } else {
          const inbox = this.inboxes.get(m.inboxId)!
          map.set(key, {
            key,
            inboxId: m.inboxId,
            inboxAddress: inbox.address,
            inboxLabel: inbox.label,
            appNumber: m.appNumber,
            last: m,
            count: 1,
            unread: m.read ? 0 : 1,
          })
        }
      }
      let list = [...map.values()]
      const text = q.q?.trim().toLowerCase()
      if (text)
        list = list.filter((c) =>
          `${c.inboxAddress} ${c.inboxLabel ?? ""} ${c.appNumber} ${c.last.body}`
            .toLowerCase()
            .includes(text)
        )
      return list
    })
    return page(all, q.cursor, q.limit)
  }

  /** One conversation, oldest first. Long threads return the newest `limit`. */
  thread(inboxId: string, appNumber: string, limit = 300): SmsMessage[] {
    return (this.byInbox.get(inboxId) ?? [])
      .map((id) => this.items.get(id) as SmsMessage)
      .filter((m) => m.appNumber === appNumber)
      .slice(0, limit)
      .reverse()
  }

  private addItem(item: ChannelItem, event: string, urlKey: string) {
    this.items.set(item.id, item)
    this.itemIds[item.channel].unshift(item.id)
    this.byInbox.get(item.inboxId)?.unshift(item.id)
    const url = String(this.adapterState[item.adapterId]?.values[urlKey] ?? "")
    const at = new Date().toISOString()
    const built = buildWebhook(item.adapterId, event, item, at, 1, url)
    this.indexWebhook({
      id: `wh-${crypto.randomUUID().slice(0, 8)}`,
      adapterId: item.adapterId,
      channel: item.channel,
      event,
      url,
      status: 200,
      durationMs: 12 + Math.round(Math.random() * 40),
      attempt: 1,
      maxAttempts: 3,
      createdAt: at,
      relatedId: item.id,
      requestHeaders: built.headers,
      requestBody: built.body,
      responseBody: '{"ok":true}',
    })
    this.recount(item.inboxId)
    this.emit("items", "inboxes", "webhooks")
    return item
  }

  /** POST /api/inboxes/:id/send. Delivered to the app as a Mailgun route forward. */
  sendEmailToApp(input: {
    inbox: Inbox
    to: string
    subject: string
    text: string
  }): EmailMessage {
    const id = `em-${crypto.randomUUID().slice(0, 8)}`
    const from = input.inbox.catchAll
      ? "someone@inbox.test"
      : input.inbox.address
    const item: EmailMessage = {
      id,
      channel: "email",
      inboxId: input.inbox.id,
      adapterId: input.inbox.adapterId,
      direction: "inbound",
      messageId: `<${id}@inbox.test>`,
      from: { name: input.inbox.label, address: from },
      to: [{ address: input.to }],
      subject: input.subject,
      text: input.text,
      attachments: [],
      headers: [
        ["Message-Id", `<${id}@inbox.test>`],
        ["From", `${input.inbox.label ?? ""} <${from}>`],
        ["To", input.to],
        ["Subject", input.subject],
        ["X-Phonybox-Origin", "inbox composer"],
      ],
      tags: [],
      status: "delivered",
      read: true,
      createdAt: new Date().toISOString(),
    }
    return this.addItem(item, "route.forward", "routeUrl") as EmailMessage
  }

  /** POST /api/inboxes/:id/send. Delivered as Telnyx message.received. */
  sendSmsToApp(input: {
    inbox: Inbox
    appNumber: string
    body: string
  }): SmsMessage {
    const id = `sm-${crypto.randomUUID().slice(0, 8)}`
    const item: SmsMessage = {
      id,
      channel: "sms",
      inboxId: input.inbox.id,
      adapterId: input.inbox.adapterId,
      direction: "inbound",
      providerId: uuid(id),
      appNumber: input.appNumber,
      peerNumber: input.inbox.address,
      body: input.body,
      media: [],
      parts: Math.max(1, Math.ceil(input.body.length / 153)),
      status: "received",
      read: true,
      createdAt: new Date().toISOString(),
    }
    return this.addItem(item, "message.received", "messagingUrl") as SmsMessage
  }

  /** POST /api/inboxes/:id/send. Delivered as Telnyx fax.received. */
  sendFaxToApp(input: {
    inbox: Inbox
    appNumber: string
    title: string
    pages: number
  }): FaxDocument {
    const id = `fx-${crypto.randomUUID().slice(0, 8)}`
    const now = new Date().toISOString()
    const item: FaxDocument = {
      id,
      channel: "fax",
      inboxId: input.inbox.id,
      adapterId: input.inbox.adapterId,
      direction: "inbound",
      providerId: uuid(id),
      appNumber: input.appNumber,
      peerNumber: input.inbox.address,
      title: input.title,
      pages: input.pages,
      quality: "high",
      status: "received",
      events: [{ event: "fax.received", at: now }],
      read: true,
      createdAt: now,
    }
    return this.addItem(item, "fax.received", "faxUrl") as FaxDocument
  }

  /* --------------------------------------------------------- webhooks */

  listWebhooks(q: WebhookQuery): Page<WebhookDelivery> {
    const ids = this.cached(
      `wh:${q.adapterId ?? ""}:${q.failedOnly ? 1 : 0}:${q.q ?? ""}`,
      () => {
        const text = q.q?.trim().toLowerCase()
        return this.webhookIds.filter((id) => {
          const w = this.webhooks.get(id)!
          if (q.adapterId && w.adapterId !== q.adapterId) return false
          if (q.failedOnly && !isFail(w.status)) return false
          if (
            text &&
            !`${w.event} ${w.url} ${w.error ?? ""}`.toLowerCase().includes(text)
          )
            return false
          return true
        })
      }
    )
    const p = page(ids, q.cursor, q.limit)
    return {
      ...p,
      items: (p.items as string[]).map((id) => this.webhooks.get(id)!),
    }
  }

  getWebhook(id: string): WebhookDelivery | null {
    const w = this.webhooks.get(id)
    if (!w) return null
    if (w.requestBody || !w.relatedId) return w
    const item = this.getItem(w.relatedId)
    if (!item) return w
    const built = buildWebhook(
      w.adapterId,
      w.event,
      item,
      w.createdAt,
      w.attempt,
      w.url
    )
    const full = {
      ...w,
      requestHeaders: built.headers,
      requestBody: built.body,
    }
    this.webhooks.set(id, full)
    return full
  }

  webhooksFor(itemId: string): WebhookDelivery[] {
    return (this.webhooksByItem.get(itemId) ?? [])
      .map((id) => this.webhooks.get(id)!)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  latestWebhook(): WebhookDelivery | null {
    return this.webhookIds.length
      ? this.webhooks.get(this.webhookIds[0])!
      : null
  }

  failingCount() {
    return this.failingTotal
  }

  webhookTargets(): WebhookTarget[] {
    return this.cached("targets", () => {
      const map = new Map<string, WebhookTarget>()
      for (const id of this.webhookIds) {
        const w = this.webhooks.get(id)!
        const t = map.get(w.url) ?? {
          url: w.url,
          adapterId: w.adapterId,
          total: 0,
          failed: 0,
          lastStatus: w.status,
        }
        t.total++
        if (isFail(w.status)) t.failed++
        map.set(w.url, t)
      }
      return [...map.values()]
    })
  }

  replayWebhook(id: string) {
    const w = this.getWebhook(id)
    if (!w) return
    this.indexWebhook({
      ...w,
      id: `wh-${crypto.randomUUID().slice(0, 8)}`,
      attempt: 1,
      status: 200,
      durationMs: 14 + Math.round(Math.random() * 30),
      createdAt: new Date().toISOString(),
      responseBody: '{"ok":true}',
      error: undefined,
    })
    const item = w.relatedId ? this.items.get(w.relatedId) : undefined
    if (item) this.recount(item.inboxId)
    this.emit("webhooks", "inboxes")
  }

  /* --------------------------------------------------------- requests */

  listRequests(q: RequestQuery): Page<ApiRequest> {
    const ids = this.cached(`rq:${q.adapterId ?? ""}:${q.q ?? ""}`, () => {
      const text = q.q?.trim().toLowerCase()
      return this.requestIds.filter((id) => {
        const r = this.requests.get(id)!
        if (q.adapterId && r.adapterId !== q.adapterId) return false
        if (
          text &&
          !`${r.method} ${r.path} ${r.status}`.toLowerCase().includes(text)
        )
          return false
        return true
      })
    })
    const p = page(ids, q.cursor, q.limit)
    return {
      ...p,
      items: (p.items as string[]).map((id) => this.requests.get(id)!),
    }
  }

  getRequest(id: string): ApiRequest | null {
    const r = this.requests.get(id)
    if (!r) return null
    if (r.requestBody || !r.relatedId) return r
    const item = this.getItem(r.relatedId)
    if (!item) return r
    const full = { ...r, ...requestBodies(item) }
    this.requests.set(id, full)
    return full
  }

  requestFor(itemId: string): ApiRequest | null {
    const id = this.requestByItem.get(itemId)
    return id ? this.getRequest(id) : null
  }

  /* --------------------------------------------------------- adapters */

  getAdapters() {
    return this.adapterState
  }

  setAdapter(id: string, patch: Partial<AdapterState>) {
    this.adapterState = {
      ...this.adapterState,
      [id]: { ...this.adapterState[id], ...patch },
    }
    this.emit("adapters")
  }

  setAdapterValue(id: string, key: string, value: string | boolean) {
    const a = this.adapterState[id]
    this.setAdapter(id, { values: { ...a.values, [key]: value } })
  }
}

/** What the app would have POSTed to create this item. */
function requestBodies(
  item: ChannelItem
): Pick<ApiRequest, "requestBody" | "responseBody"> {
  const json = (v: unknown) => JSON.stringify(v, null, 2)
  if (item.channel === "email")
    return {
      requestBody: `from=${item.from.name} <${item.from.address}>\nto=${item.to.map((t) => t.address).join(",")}\nsubject=${item.subject}\ntext=…\nhtml=…${item.tags.map((t) => `\no:tag=${t}`).join("")}`,
      responseBody: json({ id: item.messageId, message: "Queued. Thank you." }),
    }
  if (item.channel === "sms")
    return {
      requestBody: json({
        from: item.appNumber,
        to: item.peerNumber,
        text: item.body,
      }),
      responseBody: json({
        data: {
          record_type: "message",
          id: item.providerId,
          direction: "outbound",
          type: "SMS",
          parts: item.parts,
          to: [{ phone_number: item.peerNumber, status: "queued" }],
        },
      }),
    }
  return {
    requestBody: json({
      connection_id: "local-fax-app",
      from: item.appNumber,
      to: item.peerNumber,
      media_url: `http://localhost:3000/files/${item.title.toLowerCase().replace(/\W+/g, "-")}.pdf`,
    }),
    responseBody: json({
      data: { record_type: "fax", id: item.providerId, status: "queued" },
    }),
  }
}

let instance: LocalDB | null = null

/** Built on first use, so the HTTP transport never pays for generating mock data. */
export function getDb(): LocalDB {
  instance ??= new LocalDB()
  return instance
}
