import * as React from "react"
import { Link } from "react-router"
import {
  ArrowDownUpIcon,
  InboxIcon,
  PinIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { api } from "@/api/client"
import { useChannelStats, useInboxes } from "@/api/hooks"
import type { InboxFilter, InboxSort, InboxSummary } from "@/api/types"
import type { ChannelId } from "@/types/domain"
import { cn } from "@/lib/utils"
import { getChannel } from "@/channels/meta"
import { Time } from "@/components/bits"
import { VirtualList } from "@/components/virtual-list"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export const ALL = "all"

const sorts: [InboxSort, string][] = [
  ["activity", "Recent activity"],
  ["unread", "Most unread"],
  ["name", "Name"],
  ["created", "Newest"],
]

export function formatCount(n: number) {
  return n.toLocaleString("en-US")
}

/**
 * Searchable, virtualized list of every inbox on a channel. Search, filter and
 * sort run server-side; only the visible rows render.
 */
export function InboxPane({
  channel,
  selectedId,
  onSelect,
  className,
}: {
  channel: ChannelId
  selectedId: string
  onSelect: (id: string) => void
  className?: string
}) {
  const meta = getChannel(channel)
  const [q, setQ] = React.useState("")
  const query = React.useDeferredValue(q)
  const [filter, setFilter] = React.useState<InboxFilter>("all")
  const [sort, setSort] = React.useState<InboxSort>("activity")
  const list = useInboxes({ channel, q: query, filter, sort })
  const stats = useChannelStats().data?.find((s) => s.channel === channel)
  const filtered = Boolean(query) || filter !== "all"
  const activeIndex = list.items.findIndex((i) => i.id === selectedId)

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="space-y-2 border-b p-2">
        <InputGroup className="h-7">
          <InputGroupAddon>
            <SearchIcon className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${formatCount(stats?.inboxes ?? 0)} ${meta.inboxNounPlural}`}
            aria-label={`Search ${meta.inboxNounPlural}`}
            className="text-xs"
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
        <div className="flex items-center justify-between gap-1">
          <ToggleGroup
            type="single"
            size="sm"
            value={filter}
            onValueChange={(v) => v && setFilter(v as InboxFilter)}
            aria-label="Filter"
            className="gap-0"
          >
            {(["all", "unread", "pinned", "failing"] as InboxFilter[]).map(
              (f) => (
                <ToggleGroupItem
                  key={f}
                  value={f}
                  className="h-6 px-1.5 text-[11px] capitalize"
                >
                  {f}
                </ToggleGroupItem>
              )
            )}
          </ToggleGroup>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Sort">
                    <ArrowDownUpIcon />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                Sort: {sorts.find(([s]) => s === sort)?.[1]}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
                Sort by
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(v) => setSort(v as InboxSort)}
              >
                {sorts.map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!filtered ? (
        <button
          type="button"
          onClick={() => onSelect(ALL)}
          className={cn(
            "relative flex h-10 shrink-0 items-center gap-2.5 border-b px-3 text-left text-[13px] transition-colors hover:bg-accent/60",
            selectedId === ALL &&
              "bg-accent before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-foreground hover:bg-accent"
          )}
        >
          <InboxIcon className="size-4 text-muted-foreground" />
          <span className="flex-1 font-medium">All {meta.inboxNounPlural}</span>
          {stats?.unread ? <UnreadBadge n={stats.unread} /> : null}
        </button>
      ) : null}

      <VirtualList
        className="flex-1"
        label={`${meta.label} ${meta.inboxNounPlural}`}
        items={list.items}
        rowHeight={48}
        getKey={(i) => i.id}
        hasMore={list.hasMore}
        loading={list.isLoading}
        onLoadMore={list.loadMore}
        activeIndex={activeIndex}
        renderRow={(inbox) => (
          <InboxRow
            inbox={inbox}
            active={inbox.id === selectedId}
            onSelect={() => onSelect(inbox.id)}
          />
        )}
        empty={
          <p className="px-4 py-10 text-center text-xs text-muted-foreground">
            {query ? (
              <>
                No {meta.inboxNounPlural} match{" "}
                <span className="text-foreground">“{query}”</span>.
              </>
            ) : (
              `No ${filter} ${meta.inboxNounPlural}.`
            )}
          </p>
        }
      />

      <footer className="flex h-8 shrink-0 items-center justify-between border-t px-3 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {formatCount(list.total)}{" "}
          {filtered ? "matching" : `${meta.inboxNounPlural}`}
        </span>
        <Link
          to={`/inboxes?channel=${channel}`}
          className="hover:text-foreground"
        >
          Manage
        </Link>
      </footer>
    </div>
  )
}

function InboxRow({
  inbox,
  active,
  onSelect,
}: {
  inbox: InboxSummary
  active: boolean
  onSelect: () => void
}) {
  const meta = getChannel(inbox.channel)
  return (
    <div
      className={cn(
        "group/row relative flex h-full items-center border-b border-border/60 transition-colors hover:bg-accent/60",
        active &&
          "bg-accent before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-foreground hover:bg-accent"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex h-full min-w-0 flex-1 flex-col justify-center gap-px pr-1 pl-3 text-left"
      >
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              inbox.unreadCount > 0 ? "font-semibold" : "text-foreground/90"
            )}
          >
            {inbox.label ?? meta.formatAddress(inbox.address)}
          </span>
          {inbox.lastActivityAt ? (
            <Time
              iso={inbox.lastActivityAt}
              className="shrink-0 text-[10.5px] text-muted-foreground"
            />
          ) : null}
        </span>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground">
            {inbox.catchAll
              ? "any other address"
              : meta.formatAddress(inbox.address)}
          </span>
          {inbox.failing > 0 ? (
            <TriangleAlertIcon
              className="size-3 shrink-0 text-destructive"
              aria-label={`${inbox.failing} failing webhook${inbox.failing === 1 ? "" : "s"}`}
            />
          ) : null}
          {inbox.unreadCount > 0 ? <UnreadBadge n={inbox.unreadCount} /> : null}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={inbox.pinned ? "Unpin" : "Pin to sidebar"}
        onClick={() => void api.setPinned([inbox.id], !inbox.pinned)}
        className={cn(
          "mr-1.5 shrink-0 text-muted-foreground",
          inbox.pinned
            ? "opacity-100"
            : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
        )}
      >
        <PinIcon
          className={cn(inbox.pinned && "fill-current text-foreground")}
        />
      </Button>
    </div>
  )
}

export function UnreadBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium tabular-nums">
      <span className="size-1.5 rounded-full bg-signal" aria-hidden />
      {n > 999 ? `${Math.floor(n / 1000)}k` : n}
      <span className="sr-only">unread</span>
    </span>
  )
}
