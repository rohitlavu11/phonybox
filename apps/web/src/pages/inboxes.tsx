import * as React from "react"
import { useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"
import {
  CheckCheckIcon,
  EraserIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { getAdapter } from "@/adapters"
import { api } from "@/api/client"
import { useChannelStats, useInboxes } from "@/api/hooks"
import type {
  InboxFilter,
  InboxQuery,
  InboxSort,
  InboxSummary,
  Selection,
} from "@/api/types"
import type { ChannelId } from "@/types/domain"
import { channels, getChannel } from "@/channels/meta"
import { UnreadBadge, formatCount } from "@/channels/inbox-pane"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/layout/page-header"
import { NewInboxDialog } from "@/components/new-inbox-dialog"
import { VirtualList } from "@/components/virtual-list"
import { AdapterMark, Time } from "@/components/bits"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const filters: [InboxFilter, string][] = [
  ["all", "Any state"],
  ["unread", "Has unread"],
  ["pinned", "Pinned"],
  ["failing", "Failing webhooks"],
  ["idle", "Idle 24h+"],
]
const sorts: [InboxSort, string][] = [
  ["activity", "Recent activity"],
  ["unread", "Most unread"],
  ["name", "Name"],
  ["created", "Newest"],
]

/** Explicit ids, or "everything matching the query except these". */
type Picked = { key: string; all: boolean; set: Set<string> }

const GRID =
  "grid grid-cols-[2.25rem_minmax(0,1fr)_3.5rem] md:grid-cols-[2.25rem_minmax(0,1fr)_5.5rem_4.5rem_4.5rem_5rem] lg:grid-cols-[2.25rem_minmax(0,1fr)_5rem_6rem_5rem_4.5rem_6rem_5rem] items-center"

/**
 * Directory of every inbox, for the jobs that don't fit a channel view:
 * auditing what agents created, and cleaning up in bulk.
 */
export function InboxesPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const channel = (params.get("channel") as ChannelId | null) ?? undefined
  const filter = (params.get("filter") as InboxFilter | null) ?? "all"
  const sort = (params.get("sort") as InboxSort | null) ?? "activity"
  const [q, setQ] = React.useState(params.get("q") ?? "")
  const query = React.useDeferredValue(q.trim())

  const set = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params)
    if (value && value !== "all" && !(key === "sort" && value === "activity"))
      next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  React.useEffect(() => {
    const current = params.get("q") ?? ""
    if (current === query) return
    const next = new URLSearchParams(params)
    if (query) next.set("q", query)
    else next.delete("q")
    setParams(next, { replace: true })
  }, [query, params, setParams])

  const listQuery: Omit<InboxQuery, "cursor" | "limit"> = {
    channel,
    q: query,
    filter,
    sort,
  }
  const list = useInboxes(listQuery)
  const stats = useChannelStats().data ?? []

  // Selection belongs to one query; changing the query starts fresh.
  const qkey = JSON.stringify(listQuery)
  const [picked, setPicked] = React.useState<Picked>({
    key: qkey,
    all: false,
    set: new Set(),
  })
  const sel =
    picked.key === qkey
      ? picked
      : { key: qkey, all: false, set: new Set<string>() }
  const isPicked = (id: string) =>
    sel.all ? !sel.set.has(id) : sel.set.has(id)
  const count = sel.all ? list.total - sel.set.size : sel.set.size
  const loadedAllPicked =
    list.items.length > 0 && list.items.every((i) => isPicked(i.id))

  const toggle = (id: string) => {
    const next = new Set(sel.set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked({ ...sel, set: next })
  }
  const togglePage = () => {
    if (count > 0) setPicked({ key: qkey, all: false, set: new Set() })
    else
      setPicked({
        key: qkey,
        all: false,
        set: new Set(list.items.map((i) => i.id)),
      })
  }
  const clear = () => setPicked({ key: qkey, all: false, set: new Set() })
  const selection = (): Selection =>
    sel.all ? { query: listQuery, except: [...sel.set] } : { ids: [...sel.set] }

  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [creating, setCreating] = React.useState({ open: false, n: 0 })

  async function run(op: "read" | "clear" | "pin" | "unpin" | "delete") {
    const s = selection()
    const n = count
    if (op === "read") await api.markInboxesRead(s)
    if (op === "clear") await api.clearInboxes(s)
    if (op === "delete") await api.deleteInboxes(s)
    if (op === "pin" || op === "unpin") {
      // Pins are per-inbox; resolve the loaded ids rather than pinning thousands.
      const ids = sel.all
        ? list.items.filter((i) => isPicked(i.id)).map((i) => i.id)
        : [...sel.set]
      await api.setPinned(ids, op === "pin")
    }
    clear()
    const verb = {
      read: "Marked read",
      clear: "Emptied",
      pin: "Pinned",
      unpin: "Unpinned",
      delete: "Deleted",
    }[op]
    toast(`${verb} ${formatCount(n)} inbox${n === 1 ? "" : "es"}`)
  }

  const pickedLoaded = list.items.filter((i) => isPicked(i.id))
  const messagesInPicked = pickedLoaded.reduce((n, i) => n + i.messageCount, 0)

  return (
    <>
      <PageHeader
        title="Inboxes"
        meta={
          <span className="tabular-nums">
            {stats
              .map(
                (s) =>
                  `${formatCount(s.inboxes)} ${getChannel(s.channel).label.toLowerCase()}`
              )
              .join(" · ")}
          </span>
        }
      >
        <Button
          size="sm"
          className="h-7 gap-1.5"
          onClick={() => setCreating((c) => ({ open: true, n: c.n + 1 }))}
        >
          <PlusIcon /> <span className="hidden sm:inline">New</span>
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <InputGroup className="h-7 w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Address, label, or tag:run:4100"
            className="text-xs"
            aria-label="Search inboxes"
          />
          {q ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear search"
                onClick={() => setQ("")}
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={channel ?? "all"}
          onValueChange={(v) => v && set("channel", v)}
          aria-label="Channel"
        >
          <ToggleGroupItem value="all" className="px-2 text-[11px]">
            All
          </ToggleGroupItem>
          {channels.map((c) => (
            <ToggleGroupItem
              key={c.id}
              value={c.id}
              className="px-2 text-[11px]"
            >
              {c.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select value={filter} onValueChange={(v) => set("filter", v)}>
          <SelectTrigger
            size="sm"
            className="h-7 w-36 text-xs"
            aria-label="Filter"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {filters.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => set("sort", v)}>
          <SelectTrigger
            size="sm"
            className="h-7 w-36 text-xs"
            aria-label="Sort"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sorts.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {formatCount(list.total)}{" "}
          {query || filter !== "all" ? "matching" : "inboxes"}
        </span>
      </div>

      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-muted/50 px-3 py-1.5 text-xs">
          <span className="font-medium tabular-nums">
            {formatCount(count)} selected
          </span>
          {!sel.all && loadedAllPicked && list.total > list.items.length ? (
            <button
              type="button"
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() =>
                setPicked({ key: qkey, all: true, set: new Set() })
              }
            >
              Select all {formatCount(list.total)} matching
            </button>
          ) : null}
          {sel.all ? (
            <span className="text-muted-foreground">
              Every inbox matching this view
              {sel.set.size ? `, minus ${sel.set.size}` : ""}.
            </span>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => void run("read")}
            >
              <CheckCheckIcon /> Mark read
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => void run("pin")}
            >
              <PinIcon /> Pin
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => void run("unpin")}
            >
              <PinOffIcon /> Unpin
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => void run("clear")}
            >
              <EraserIcon /> Empty
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2Icon /> Delete
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear selection"
              onClick={clear}
            >
              <XIcon />
            </Button>
          </div>
        </div>
      ) : null}

      <VirtualList
        className="flex-1"
        label="Inboxes"
        items={list.items}
        rowHeight={48}
        getKey={(i) => i.id}
        hasMore={list.hasMore}
        loading={list.isLoading}
        onLoadMore={list.loadMore}
        header={
          <div
            role="row"
            className={cn(
              GRID,
              "sticky top-0 z-10 h-8 border-b bg-background text-[11px] font-medium text-muted-foreground"
            )}
          >
            <span className="flex justify-center">
              <Checkbox
                aria-label={count ? "Clear selection" : "Select loaded rows"}
                checked={
                  loadedAllPicked ? true : count > 0 ? "indeterminate" : false
                }
                onCheckedChange={togglePage}
              />
            </span>
            <span>Inbox</span>
            <span className="hidden md:block">Channel</span>
            <span className="hidden lg:block">Adapter</span>
            <span className="hidden text-right md:block">Items</span>
            <span className="pr-3 text-right md:pr-0">Unread</span>
            <span className="hidden pr-4 text-right lg:block">Activity</span>
            <span className="hidden pr-3 text-right md:block">Created by</span>
          </div>
        }
        renderRow={(inbox) => (
          <Row
            inbox={inbox}
            picked={isPicked(inbox.id)}
            onToggle={() => toggle(inbox.id)}
            onOpen={() =>
              navigate(`${getChannel(inbox.channel).path}/${inbox.id}`)
            }
          />
        )}
        empty={
          <p className="py-16 text-center text-xs text-muted-foreground">
            No inboxes match this view.
          </p>
        }
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Delete {formatCount(count)} inbox{count === 1 ? "" : "es"}?
            </DialogTitle>
            <DialogDescription>
              {sel.all
                ? "Every inbox in this view and all of its messages will be removed. Webhook and API logs are kept."
                : `${formatCount(messagesInPicked)} messages go with them. Webhook and API logs are kept.`}{" "}
              Catch-all inboxes are skipped.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDelete(false)
                void run("delete")
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewInboxDialog
        key={creating.n}
        channel={channel ?? "email"}
        open={creating.open}
        onOpenChange={(open) => setCreating((c) => ({ ...c, open }))}
      />
    </>
  )
}

function Row({
  inbox,
  picked,
  onToggle,
  onOpen,
}: {
  inbox: InboxSummary
  picked: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const meta = getChannel(inbox.channel)
  return (
    <div
      role="row"
      aria-selected={picked}
      onClick={onOpen}
      className={cn(
        GRID,
        "h-full cursor-pointer border-b border-border/60 text-xs transition-colors hover:bg-accent/50",
        picked && "bg-accent/70 hover:bg-accent"
      )}
    >
      <span
        className="flex justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={picked}
          onCheckedChange={onToggle}
          aria-label={`Select ${inbox.address}`}
        />
      </span>
      <span className="min-w-0 pr-3">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate text-[13px]",
              inbox.unreadCount > 0 && "font-medium"
            )}
          >
            {inbox.label ?? meta.formatAddress(inbox.address)}
          </span>
          {inbox.pinned ? (
            <PinIcon
              className="size-3 shrink-0 fill-current text-muted-foreground"
              aria-label="Pinned"
            />
          ) : null}
          {inbox.failing > 0 ? (
            <span className="shrink-0 text-[10.5px] font-medium text-destructive">
              {inbox.failing} failing
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[10.5px] text-muted-foreground">
            {inbox.catchAll
              ? "any other address"
              : meta.formatAddress(inbox.address)}
          </span>
          <span className="hidden min-w-0 gap-1 truncate xl:flex">
            {inbox.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="rounded-[3px] bg-muted px-1 font-mono text-[10px] text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </span>
        </span>
      </span>
      <span className="hidden items-center gap-1.5 text-muted-foreground md:flex">
        <meta.icon className="size-3.5" /> {meta.label}
      </span>
      <span className="hidden items-center gap-1.5 text-muted-foreground lg:flex">
        <AdapterMark id={inbox.adapterId} className="size-4 text-[9px]" />
        {getAdapter(inbox.adapterId)?.name}
      </span>
      <span className="hidden text-right text-muted-foreground tabular-nums md:block">
        {formatCount(inbox.messageCount)}
      </span>
      <span className="flex justify-end pr-3 md:pr-0">
        {inbox.unreadCount ? (
          <UnreadBadge n={inbox.unreadCount} />
        ) : (
          <span className="text-muted-foreground/50">0</span>
        )}
      </span>
      <span className="hidden pr-4 text-right text-muted-foreground lg:block">
        {inbox.lastActivityAt ? <Time iso={inbox.lastActivityAt} /> : "never"}
      </span>
      <span className="hidden pr-3 text-right text-muted-foreground capitalize md:block">
        {inbox.createdBy}
      </span>
    </div>
  )
}
