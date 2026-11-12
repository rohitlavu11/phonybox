import * as React from "react"
import { Link, useNavigate, useParams } from "react-router"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  BanIcon,
  ImageIcon,
  MessageSquareTextIcon,
  PenSquareIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import { api } from "@/api/client"
import {
  useAdapterStates,
  useConversations,
  useThread,
  useWebhooksFor,
} from "@/api/hooks"
import type { Conversation, InboxSummary } from "@/api/types"
import type { SmsMessage } from "@/types/domain"
import { clockTime, formatBytes, formatPhone } from "@/lib/format"
import { appNumbers } from "@/mocks/seed"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { Extracted } from "@/components/extracted"
import { ItemInspector } from "@/components/item-inspector"
import { VirtualList } from "@/components/virtual-list"
import { AdapterMark, Time, UnreadDot } from "@/components/bits"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChannelShell } from "../channel-shell"
import { UnreadBadge, formatCount } from "../inbox-pane"
import { InboxActions } from "../inbox-actions"
import { InboundRoute } from "../send-to-app"

const QUICK_REPLIES = ["STOP", "START", "HELP", "Y", "C"]

export function SmsView({ inbox }: { inbox: InboxSummary | null }) {
  const { itemId } = useParams()
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const [q, setQ] = React.useState("")
  const query = React.useDeferredValue(q)
  const convs = useConversations({ inboxId: inbox?.id, q: query })
  const states = useAdapterStates()

  // In a number, the first conversation opens by default on wide screens.
  const appNumber = itemId
    ? `+${itemId}`
    : inbox && !mobile
      ? convs.items[0]?.appNumber
      : undefined
  const activeKey = inbox && appNumber ? `${inbox.id}|${appNumber}` : ""
  const open = (c: Conversation) =>
    navigate(`/sms/${c.inboxId}/${c.appNumber.slice(1)}`)
  const ownNumbers = String(states.telnyx?.values.appNumbers ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)

  const listPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <InputGroup className="h-7">
          <InputGroupAddon>
            <SearchIcon className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={inbox ? "Search conversations" : "Search all texts"}
            className="text-xs"
            aria-label="Search conversations"
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
        {inbox ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Text an app number"
              >
                <PenSquareIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
                Text one of your app's numbers
              </DropdownMenuLabel>
              {ownNumbers.map((n) => (
                <DropdownMenuItem
                  key={n}
                  onSelect={() => navigate(`/sms/${inbox.id}/${n.slice(1)}`)}
                >
                  <span className="font-mono text-xs">{formatPhone(n)}</span>
                  <span className="ml-auto truncate text-[11px] text-muted-foreground">
                    {appNumbers[n]}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <VirtualList
        className="flex-1"
        label="Conversations"
        items={convs.items}
        rowHeight={inbox ? 64 : 80}
        getKey={(c) => c.key}
        hasMore={convs.hasMore}
        loading={convs.isLoading}
        onLoadMore={convs.loadMore}
        activeIndex={convs.items.findIndex((c) => c.key === activeKey)}
        renderRow={(c) => (
          <ConversationRow
            c={c}
            showInbox={!inbox}
            active={c.key === activeKey}
            onOpen={() => open(c)}
          />
        )}
        empty={
          inbox && !query ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <MessageSquareTextIcon className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">No texts yet</p>
              <p className="text-xs text-muted-foreground">
                Have your app send to{" "}
                <code className="text-foreground">{inbox.address}</code> with{" "}
                <code className="text-foreground">POST /v2/messages</code>.
              </p>
            </div>
          ) : (
            <p className="px-4 py-10 text-center text-xs text-muted-foreground">
              Nothing matches.
            </p>
          )
        }
      />
      <div className="flex h-7 shrink-0 items-center border-t px-3 text-[11px] text-muted-foreground tabular-nums">
        {formatCount(convs.total)} conversation{convs.total === 1 ? "" : "s"}
      </div>
    </div>
  )

  const detail =
    inbox && appNumber ? (
      <Thread
        key={activeKey}
        inbox={inbox}
        appNumber={appNumber}
        onBack={() => navigate(`/sms/${inbox.id}`)}
      />
    ) : (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-xs text-muted-foreground">
        <MessageSquareTextIcon className="size-5 opacity-50" />
        {inbox ? (
          <p>No conversation selected</p>
        ) : (
          <p>Open a conversation to see it in its number.</p>
        )}
      </div>
    )

  return (
    <ChannelShell
      channel="sms"
      inbox={inbox}
      hasDetail={Boolean(itemId)}
      list={listPane}
      detail={<div className="flex h-full min-h-0 flex-col">{detail}</div>}
      listSize="34%"
      actions={inbox ? <InboxActions inbox={inbox} /> : null}
    />
  )
}

function ConversationRow({
  c,
  showInbox,
  active,
  onOpen,
}: {
  c: Conversation
  showInbox: boolean
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active || undefined}
      className={cn(
        "relative grid h-full w-full grid-cols-[0.375rem_1fr] gap-x-2.5 border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-accent/60",
        active &&
          "bg-accent before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-foreground hover:bg-accent"
      )}
    >
      <UnreadDot show={c.unread > 0} className="mt-1.5" />
      <div className="min-w-0 space-y-0.5">
        {showInbox ? (
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px]",
                c.unread && "font-semibold"
              )}
            >
              {c.inboxLabel ?? formatPhone(c.inboxAddress)}
            </span>
            <Time
              iso={c.last.createdAt}
              className="text-[11px] text-muted-foreground"
            />
          </div>
        ) : null}
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-[12px]",
              showInbox ? "text-muted-foreground" : c.unread && "font-semibold"
            )}
          >
            {showInbox
              ? `${formatPhone(c.inboxAddress)} ↔ ${formatPhone(c.appNumber)}`
              : formatPhone(c.appNumber)}
          </span>
          {!showInbox ? (
            <Time
              iso={c.last.createdAt}
              className="text-[11px] text-muted-foreground"
            />
          ) : null}
        </div>
        {!showInbox ? (
          <div className="truncate text-[11px] text-muted-foreground">
            {appNumbers[c.appNumber] ?? "App number"}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
            {c.last.direction === "inbound" ? (
              <span className="text-muted-foreground">Sent to app: </span>
            ) : null}
            {c.last.body}
          </span>
          {c.unread > 1 ? <UnreadBadge n={c.unread} /> : null}
        </div>
      </div>
    </button>
  )
}

function Thread({
  inbox,
  appNumber,
  onBack,
}: {
  inbox: InboxSummary
  appNumber: string
  onBack: () => void
}) {
  const messages = useThread(inbox.id, appNumber).data ?? []
  const [draft, setDraft] = React.useState("")
  const [inspect, setInspect] = React.useState<SmsMessage | null>(null)
  const endRef = React.useRef<HTMLDivElement>(null)

  // Opted out if the last STOP/START keyword the inbox sent was STOP.
  const lastKeyword = [...messages]
    .reverse()
    .find(
      (m) =>
        m.direction === "inbound" &&
        /^(stop|start|unstop)$/i.test(m.body.trim())
    )
  const optedOut = lastKeyword ? /^stop$/i.test(lastKeyword.body.trim()) : false
  const unread = messages
    .filter((m) => !m.read)
    .map((m) => m.id)
    .join(",")

  React.useEffect(() => {
    if (unread) void api.setItemsRead(unread.split(","), true)
  }, [unread])

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [messages.length])

  function send(body = draft) {
    if (!body.trim()) return
    void api.sendSmsToApp({ inbox, appNumber, body: body.trim() })
    setDraft("")
    toast.success("Delivered to your app", {
      description: "message.received → 200 OK",
    })
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Back to conversations"
          className="md:hidden"
        >
          <ArrowLeftIcon />
        </Button>
        <span className="font-mono text-[12px] font-medium">
          {formatPhone(appNumber)}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {appNumbers[appNumber]}
        </span>
        {optedOut ? (
          <span className="inline-flex items-center gap-1 rounded-[4px] border border-destructive/30 px-1.5 py-px text-[10.5px] font-medium text-destructive">
            <BanIcon className="size-3" /> Opted out
          </span>
        ) : null}
        <div className="flex-1" />
        <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:inline-flex">
          <AdapterMark id="telnyx" className="size-4 text-[9px]" /> Telnyx
          messaging
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ol className="mx-auto flex max-w-2xl flex-col gap-1 px-4 py-5">
          {messages.length ? (
            messages.map((m, i) => {
              const prev = messages[i - 1]
              const grouped =
                prev &&
                prev.direction === m.direction &&
                Date.parse(m.createdAt) - Date.parse(prev.createdAt) < 120_000
              return (
                <Bubble
                  key={m.id}
                  m={m}
                  grouped={Boolean(grouped)}
                  onInspect={() => setInspect(m)}
                />
              )
            })
          ) : (
            <li className="py-10 text-center text-xs text-muted-foreground">
              Start the conversation. Your app receives it as{" "}
              <code>message.received</code>.
            </li>
          )}
          <div ref={endRef} />
        </ol>
      </ScrollArea>

      <div className="shrink-0 border-t bg-background px-3 pt-2 pb-3">
        <div className="mx-auto max-w-2xl space-y-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] text-muted-foreground">
              Keywords
            </span>
            {QUICK_REPLIES.map((k) => (
              <Button
                key={k}
                variant="outline"
                size="xs"
                className="font-mono"
                onClick={() => send(k)}
              >
                {k}
              </Button>
            ))}
          </div>
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={1}
              placeholder={`Text ${formatPhone(appNumber)} as ${formatPhone(inbox.address)}`}
              aria-label="Message"
              className="max-h-40 min-h-10 resize-none py-2.5 pr-12 text-[13px]"
            />
            <Button
              type="submit"
              size="icon-sm"
              disabled={!draft.trim()}
              aria-label="Send to app"
              className="absolute right-2 bottom-2 rounded-full"
            >
              <ArrowUpIcon />
            </Button>
          </form>
          <div className="flex items-center justify-between gap-3">
            <InboundRoute
              inbox={inbox}
              event="message.received"
              urlKey="messagingUrl"
            />
            <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground sm:flex">
              <Kbd>↵</Kbd> send · <Kbd>⇧↵</Kbd> newline ·{" "}
              {Math.max(1, Math.ceil(draft.length / 153))} segment
            </span>
          </div>
        </div>
      </div>

      <ItemInspector
        item={inspect}
        onOpenChange={(o) => !o && setInspect(null)}
      />
    </section>
  )
}

function Bubble({
  m,
  grouped,
  onInspect,
}: {
  m: SmsMessage
  grouped: boolean
  onInspect: () => void
}) {
  // From the inbox's point of view: what the app sent arrives on the left.
  const fromApp = m.direction === "outbound"
  const hooks = (useWebhooksFor(m.id).data ?? []).filter(
    (w) => w.event === "message.received"
  )
  const lastHook = hooks[hooks.length - 1]
  const hookFailed =
    lastHook && (lastHook.status === null || lastHook.status >= 400)

  return (
    <li
      className={cn(
        "flex flex-col",
        fromApp ? "items-start" : "items-end",
        !grouped && "mt-3"
      )}
    >
      <button
        type="button"
        onClick={onInspect}
        className={cn(
          "group max-w-[min(80%,28rem)] rounded-2xl px-3.5 py-2 text-left text-[13.5px] leading-snug transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          fromApp
            ? "rounded-bl-md bg-muted text-foreground hover:bg-accent"
            : "rounded-br-md bg-primary text-primary-foreground hover:bg-primary/90",
          hookFailed && "ring-1 ring-destructive/60"
        )}
      >
        {m.media.map((media) => (
          <span
            key={media.filename}
            className={cn(
              "mb-1.5 flex h-28 w-52 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-[11px]",
              fromApp
                ? "border-border bg-background/60 text-muted-foreground"
                : "border-primary-foreground/30 text-primary-foreground/80"
            )}
          >
            <ImageIcon className="size-4" />
            <span className="font-mono">{media.filename}</span>
            <span className="opacity-70">{formatBytes(media.size)}</span>
          </span>
        ))}
        <span className="whitespace-pre-wrap">{m.body}</span>
      </button>

      {fromApp ? (
        <Extracted text={m.body} className="mt-1 max-w-[80%] [&>span]:h-6" />
      ) : null}

      <div className="mt-0.5 flex items-center gap-1.5 px-1 text-[10.5px] text-muted-foreground">
        <span className="tabular-nums">{clockTime(m.createdAt)}</span>
        <span aria-hidden>·</span>
        {fromApp ? (
          <span
            className={cn(
              "capitalize",
              m.status === "failed" && "text-destructive"
            )}
          >
            {m.status}
          </span>
        ) : hookFailed ? (
          <Link
            to={`/webhooks?id=${lastHook.id}`}
            className="font-medium text-destructive underline-offset-2 hover:underline"
          >
            App returned {lastHook.status ?? "no response"} · {hooks.length} of{" "}
            {lastHook.maxAttempts} tries
          </Link>
        ) : lastHook ? (
          <span>Webhook {lastHook.status}</span>
        ) : (
          <span>Sent</span>
        )}
        {m.parts > 1 ? <span>· {m.parts} parts</span> : null}
      </div>

      {m.note ? (
        <p className="mx-auto mt-3 mb-1 max-w-sm text-center text-[11px] leading-relaxed text-muted-foreground">
          {m.note}
        </p>
      ) : null}
    </li>
  )
}
