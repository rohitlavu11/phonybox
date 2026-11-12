import * as React from "react"
import { Link, useNavigate, useParams } from "react-router"
import { toast } from "sonner"
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CodeIcon,
  DownloadIcon,
  EllipsisIcon,
  MailIcon,
  MailOpenIcon,
  MonitorIcon,
  PaperclipIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  SmartphoneIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { api } from "@/api/client"
import {
  useInbox,
  useItem,
  useItems,
  useRequestFor,
  useWebhooksFor,
} from "@/api/hooks"
import type { InboxSummary } from "@/api/types"
import type { EmailMessage } from "@/types/domain"
import { formatBytes, fullTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Extracted } from "@/components/extracted"
import { VirtualList } from "@/components/virtual-list"
import {
  AdapterMark,
  CodeBlock,
  CopyButton,
  DirectionTag,
  HttpCode,
  KeyValue,
  StatusLabel,
  Time,
  UnreadDot,
} from "@/components/bits"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { ChannelShell } from "../channel-shell"
import { ALL, formatCount } from "../inbox-pane"
import { InboxActions } from "../inbox-actions"
import { useHotkey } from "../send-to-app"
import { ComposeEmail } from "./compose-email"

type Filter = "all" | "outbound" | "inbound"

export function MailView({ inbox }: { inbox: InboxSummary | null }) {
  const { itemId } = useParams()
  const navigate = useNavigate()
  const [q, setQ] = React.useState("")
  const query = React.useDeferredValue(q)
  const [filter, setFilter] = React.useState<Filter>("all")
  const [compose, setCompose] = React.useState<{
    open: boolean
    n: number
    replyTo?: EmailMessage
  }>({ open: false, n: 0 })
  const searchRef = React.useRef<HTMLInputElement>(null)

  const list = useItems({
    channel: "email",
    inboxId: inbox?.id,
    direction: filter === "all" ? undefined : filter,
    q: query,
  })
  const messages = list.items as EmailMessage[]
  const { data: selected } = useItem(itemId)
  const replyInbox =
    useInbox(inbox ? undefined : (selected?.inboxId ?? undefined)).data ?? inbox
  const base = `/mail/${inbox?.id ?? ALL}`
  const activeIndex = messages.findIndex((m) => m.id === itemId)

  React.useEffect(() => {
    if (selected && !selected.read) void api.setItemsRead([selected.id], true)
  }, [selected])

  const openCompose = (replyTo?: EmailMessage) =>
    setCompose((c) => ({ open: true, n: c.n + 1, replyTo }))
  const step = (delta: number) => {
    const next =
      messages[Math.min(messages.length - 1, Math.max(0, activeIndex + delta))]
    if (next) navigate(`${base}/${next.id}`)
  }
  useHotkey("j", () => step(1))
  useHotkey("k", () => step(-1))
  useHotkey("/", () => searchRef.current?.focus())
  useHotkey("c", () => inbox && openCompose())
  useHotkey("r", () => selected?.channel === "email" && openCompose(selected))

  const listPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <InputGroup className="h-7">
          <InputGroupAddon>
            <SearchIcon className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchRef}
            placeholder={inbox ? "Search this inbox" : "Search all mail"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="text-xs"
            aria-label="Search messages"
          />
          <InputGroupAddon align="inline-end">
            {q ? (
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear search"
                onClick={() => setQ("")}
              >
                <XIcon />
              </InputGroupButton>
            ) : (
              <Kbd>/</Kbd>
            )}
          </InputGroupAddon>
        </InputGroup>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={filter}
          onValueChange={(v) => v && setFilter(v as Filter)}
          aria-label="Direction"
        >
          <ToggleGroupItem value="all" className="px-2 text-[11px]">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="outbound" className="px-2 text-[11px]">
            Out
          </ToggleGroupItem>
          <ToggleGroupItem value="inbound" className="px-2 text-[11px]">
            In
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <VirtualList
        className="flex-1"
        label="Messages"
        items={messages}
        rowHeight={78}
        getKey={(m) => m.id}
        hasMore={list.hasMore}
        loading={list.isLoading}
        onLoadMore={list.loadMore}
        activeIndex={activeIndex}
        renderRow={(m) => (
          <MessageRow
            m={m}
            showInbox={!inbox}
            catchAll={Boolean(inbox?.catchAll)}
            active={m.id === itemId}
            onOpen={() => navigate(`${base}/${m.id}`)}
          />
        )}
        empty={
          inbox && !query && filter === "all" ? (
            <EmptyInbox inbox={inbox} />
          ) : (
            <p className="px-4 py-10 text-center text-xs text-muted-foreground">
              Nothing matches.
            </p>
          )
        }
      />
      <div className="flex h-7 shrink-0 items-center border-t px-3 text-[11px] text-muted-foreground tabular-nums">
        {formatCount(list.total)} message{list.total === 1 ? "" : "s"}
      </div>
    </div>
  )

  const detail =
    selected?.channel === "email" ? (
      <MessageDetail
        m={selected}
        onBack={() => navigate(base)}
        onReply={() => openCompose(selected)}
        onDelete={() => {
          const next = messages[activeIndex + 1] ?? messages[activeIndex - 1]
          void api.deleteItem(selected.id)
          navigate(next ? `${base}/${next.id}` : base)
          toast("Message deleted")
        }}
      />
    ) : (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
        <MailIcon className="size-5 opacity-50" aria-hidden />
        <p>Select a message</p>
        <p className="flex items-center gap-1">
          <Kbd>j</Kbd> <Kbd>k</Kbd> to move
          {inbox ? (
            <>
              , <Kbd>c</Kbd> to write to your app
            </>
          ) : null}
        </p>
      </div>
    )

  return (
    <>
      <ChannelShell
        channel="email"
        inbox={inbox}
        hasDetail={Boolean(itemId)}
        list={listPane}
        detail={detail}
        actions={
          inbox ? (
            <>
              <Button
                size="sm"
                onClick={() => openCompose()}
                className="h-7 gap-1.5"
              >
                <SendIcon />{" "}
                <span className="hidden sm:inline">Send to app</span>
              </Button>
              <InboxActions inbox={inbox} />
            </>
          ) : null
        }
      />
      {replyInbox ? (
        <ComposeEmail
          key={compose.n}
          inbox={replyInbox}
          open={compose.open}
          replyTo={compose.replyTo}
          onOpenChange={(o) => setCompose((c) => ({ ...c, open: o }))}
          onSent={(m) => navigate(`/mail/${inbox ? inbox.id : ALL}/${m.id}`)}
        />
      ) : null}
    </>
  )
}

/* --------------------------------------------------------------- list row */

function MessageRow({
  m,
  showInbox,
  catchAll,
  active,
  onOpen,
}: {
  m: EmailMessage
  showInbox: boolean
  catchAll: boolean
  active: boolean
  onOpen: () => void
}) {
  const who =
    m.direction === "inbound" || catchAll
      ? `To ${m.to[0]?.address}`
      : (m.from.name ?? m.from.address)
  const inboxAddress =
    m.direction === "outbound" ? m.to[0]?.address : m.from.address

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active || undefined}
      className={cn(
        "relative grid h-full w-full grid-cols-[0.375rem_1fr] gap-x-2.5 border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none",
        active &&
          "bg-accent before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-foreground hover:bg-accent"
      )}
    >
      <UnreadDot show={!m.read} className="mt-1.5" />
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              !m.read ? "font-semibold" : "text-foreground/90"
            )}
          >
            {who}
          </span>
          <Time
            iso={m.createdAt}
            className="shrink-0 text-[11px] text-muted-foreground"
          />
        </div>
        <div
          className={cn(
            "truncate text-[13px]",
            !m.read ? "font-medium" : "text-foreground/80"
          )}
        >
          {m.subject}
        </div>
        <div className="flex items-center gap-2">
          {showInbox ? (
            <span className="max-w-[55%] shrink-0 truncate rounded-[4px] bg-muted px-1 font-mono text-[10.5px] text-muted-foreground">
              {inboxAddress}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {m.text.replace(/\s+/g, " ").slice(0, 140)}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
            {m.attachments.length ? (
              <PaperclipIcon className="size-3" aria-label="Has attachments" />
            ) : null}
            {m.status === "bounced" || m.status === "failed" ? (
              <StatusLabel status={m.status} />
            ) : null}
            <DirectionTag
              direction={m.direction}
              adapterId={m.adapterId}
              compact
            />
          </span>
        </div>
      </div>
    </button>
  )
}

/* --------------------------------------------------------------- detail */

function MessageDetail({
  m,
  onBack,
  onReply,
  onDelete,
}: {
  m: EmailMessage
  onBack: () => void
  onReply: () => void
  onDelete: () => void
}) {
  const [width, setWidth] = React.useState<"desktop" | "mobile">("desktop")
  const hooks = useWebhooksFor(m.id).data ?? []
  const request = useRequestFor(m.id).data
  const raw = [...m.headers.map(([k, v]) => `${k}: ${v}`), "", m.text].join(
    "\n"
  )
  const fmt = (a: { name?: string; address: string }) =>
    a.name ? `${a.name} <${a.address}>` : a.address

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Back to list"
          className="md:hidden"
        >
          <ArrowLeftIcon />
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onReply}
              className="gap-1.5"
            >
              <ReplyIcon /> Reply
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Reply from this inbox. Your app gets it as an inbound webhook.{" "}
            <Kbd className="ml-1">r</Kbd>
          </TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => void api.setItemsRead([m.id], !m.read)}
        >
          {m.read ? <MailIcon /> : <MailOpenIcon />}{" "}
          {m.read ? "Mark unread" : "Mark read"}
        </Button>
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More actions">
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => toast("Saved message.eml")}>
              <DownloadIcon /> Download .eml
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void navigator.clipboard?.writeText(JSON.stringify(m, null, 2))
                toast("Copied as JSON")
              }}
            >
              <CodeIcon /> Copy as JSON
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2Icon /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <article className="mx-auto max-w-3xl space-y-4 px-5 py-5">
          <header className="space-y-3">
            <h2 className="text-lg leading-snug font-medium tracking-tight text-balance">
              {m.subject}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <DirectionTag direction={m.direction} adapterId={m.adapterId} />
              <span className="text-border" aria-hidden>
                |
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <AdapterMark id={m.adapterId} className="size-4 text-[9px]" />
                {m.direction === "outbound"
                  ? "via Mailgun API"
                  : "via Mailgun route"}
              </span>
              <span className="text-border" aria-hidden>
                |
              </span>
              <StatusLabel status={m.status} />
              {m.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-[4px] border px-1.5 font-mono text-[10.5px] text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
            <KeyValue
              rows={[
                ["From", fmt(m.from)],
                ["To", m.to.map(fmt).join(", ")],
                ["Date", fullTime(m.createdAt)],
                [
                  "Message-ID",
                  <span className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
                    <span className="min-w-0 truncate">{m.messageId}</span>
                    <CopyButton value={m.messageId} label="Copy Message-ID" />
                  </span>,
                ],
              ]}
            />
          </header>

          {m.status === "bounced" ? (
            <div className="flex gap-2.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs">
              <AlertTriangleIcon className="mt-px size-4 shrink-0 text-destructive" />
              <div className="space-y-0.5">
                <p className="font-medium">
                  Bounced by fault rule <code>bounce-billing</code>
                </p>
                <p className="text-muted-foreground">
                  The message was captured, but your app was told it failed with
                  a <code className="text-foreground">permanent_fail</code>{" "}
                  webhook (550 5.1.1).{" "}
                  <Link
                    to="/adapters/mailgun?tab=faults"
                    className="text-foreground underline underline-offset-2"
                  >
                    Edit rule
                  </Link>
                </p>
              </div>
            </div>
          ) : null}

          <Extracted text={m.text} />

          {m.attachments.length ? (
            <ul className="flex flex-wrap gap-2">
              {m.attachments.map((a) => (
                <li key={a.filename}>
                  <button
                    type="button"
                    onClick={() => toast(`Saved ${a.filename}`)}
                    className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                  >
                    <span className="flex h-7 w-6 items-center justify-center rounded-[3px] border bg-muted font-mono text-[8px] font-semibold text-muted-foreground uppercase">
                      {a.filename.split(".").pop()}
                    </span>
                    <span>
                      <span className="block font-medium">{a.filename}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {formatBytes(a.size)}
                      </span>
                    </span>
                    <DownloadIcon className="ml-1 size-3.5 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <Tabs defaultValue={m.html ? "preview" : "text"} className="gap-3">
            <div className="flex items-center justify-between gap-2 border-b">
              <TabsList variant="line" className="h-8">
                {m.html ? (
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                ) : null}
                <TabsTrigger value="text">Text</TabsTrigger>
                {m.html ? <TabsTrigger value="html">HTML</TabsTrigger> : null}
                <TabsTrigger value="headers">Headers</TabsTrigger>
                <TabsTrigger value="raw">Raw</TabsTrigger>
                <TabsTrigger value="events" className="gap-1">
                  Webhooks
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {hooks.length}
                  </span>
                </TabsTrigger>
              </TabsList>
              {m.html ? (
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={width}
                  onValueChange={(v) => v && setWidth(v as typeof width)}
                  aria-label="Preview width"
                  className="mb-1 hidden md:flex"
                >
                  <ToggleGroupItem
                    value="desktop"
                    aria-label="Desktop width"
                    className="h-6 w-7 min-w-0"
                  >
                    <MonitorIcon className="size-3.5" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="mobile"
                    aria-label="Mobile width"
                    className="h-6 w-7 min-w-0"
                  >
                    <SmartphoneIcon className="size-3.5" />
                  </ToggleGroupItem>
                </ToggleGroup>
              ) : null}
            </div>

            {m.html ? (
              <TabsContent value="preview">
                <div className="flex justify-center rounded-md border bg-[#f4f4f2]">
                  <iframe
                    title="Email preview"
                    sandbox=""
                    srcDoc={m.html}
                    className={cn(
                      "h-[560px] rounded-md bg-white transition-[width] duration-200",
                      width === "desktop" ? "w-full" : "w-[375px] border-x"
                    )}
                  />
                </div>
              </TabsContent>
            ) : null}
            <TabsContent value="text">
              <div className="rounded-md border bg-card px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap">
                {m.text}
              </div>
            </TabsContent>
            {m.html ? (
              <TabsContent value="html">
                <CodeBlock
                  code={m.html}
                  wrap
                  className="max-h-[520px] overflow-auto"
                />
              </TabsContent>
            ) : null}
            <TabsContent value="headers">
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-xs">
                  <tbody className="divide-y">
                    {m.headers.map(([k, v], i) => (
                      <tr key={i} className="align-top">
                        <td className="w-40 bg-muted/40 px-3 py-1.5 font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                          {k}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[11px] break-all">
                          {v}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
            <TabsContent value="raw">
              <CodeBlock code={raw} wrap title="message.eml" />
            </TabsContent>
            <TabsContent value="events" className="space-y-3">
              {request ? (
                <section className="space-y-1.5">
                  <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    API call from your app
                  </h3>
                  <Link
                    to={`/requests?id=${request.id}`}
                    className="flex items-center gap-3 rounded-md border px-3 py-2 text-xs transition-colors hover:bg-accent"
                  >
                    <HttpCode status={request.status} />
                    <span className="font-mono text-[11px] font-medium">
                      {request.method}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                      {request.path}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {request.durationMs}ms
                    </span>
                  </Link>
                </section>
              ) : null}
              <section className="space-y-1.5">
                <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Webhooks sent to your app
                </h3>
                {hooks.length ? (
                  <ol className="divide-y overflow-hidden rounded-md border">
                    {hooks.map((w) => (
                      <li key={w.id}>
                        <Link
                          to={`/webhooks?id=${w.id}`}
                          className="flex items-center gap-3 px-3 py-2 text-xs transition-colors hover:bg-accent"
                        >
                          <HttpCode status={w.status} />
                          <code className="text-[11px] font-medium">
                            {w.event}
                          </code>
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                            {w.error ?? w.url}
                          </span>
                          <span className="text-muted-foreground">
                            try {w.attempt}/{w.maxAttempts}
                          </span>
                          <Time
                            iso={w.createdAt}
                            className="w-8 text-right text-muted-foreground"
                          />
                        </Link>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
                    No webhooks for this message. Set an event webhook URL on
                    the Mailgun adapter to get <code>delivered</code> events.
                  </p>
                )}
              </section>
            </TabsContent>
          </Tabs>
        </article>
      </ScrollArea>
    </div>
  )
}

/* ---------------------------------------------------------------- empty */

function EmptyInbox({ inbox }: { inbox: InboxSummary }) {
  const to = inbox.catchAll ? "anyone@example.com" : inbox.address
  const curl = `curl -s --user "api:key-local" \\
  http://127.0.0.1:4101/v3/mg.acme.test/messages \\
  -F from="Acme <noreply@mg.acme.test>" \\
  -F to=${to} \\
  -F subject="Hello" -F text="Testing"`
  return (
    <Empty className="px-4 py-10">
      <EmptyHeader>
        <EmptyTitle className="text-sm">No mail yet</EmptyTitle>
        <EmptyDescription className="text-xs">
          Send to <code className="text-foreground">{to}</code> from your app
          through the Mailgun adapter and it shows up here.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-full">
        <CodeBlock code={curl} className="w-full text-left" />
      </EmptyContent>
    </Empty>
  )
}
