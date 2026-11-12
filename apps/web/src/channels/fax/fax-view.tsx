import * as React from "react"
import { Link, useNavigate, useParams } from "react-router"
import { toast } from "sonner"
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  DownloadIcon,
  FileUpIcon,
  PrinterIcon,
  SearchIcon,
  SendIcon,
  XIcon,
} from "lucide-react"
import { api } from "@/api/client"
import { useItem, useItems, useWebhooksFor } from "@/api/hooks"
import type { InboxSummary } from "@/api/types"
import type { FaxDocument } from "@/types/domain"
import { clockTime, formatPhone, fullTime, pluralize } from "@/lib/format"
import { appNumbers } from "@/mocks/seed"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { ItemInspector } from "@/components/item-inspector"
import { VirtualList } from "@/components/virtual-list"
import {
  DirectionTag,
  HttpCode,
  KeyValue,
  StatusLabel,
  Time,
  UnreadDot,
} from "@/components/bits"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ChannelShell } from "../channel-shell"
import { ALL, formatCount } from "../inbox-pane"
import { InboxActions } from "../inbox-actions"
import { InboundRoute } from "../send-to-app"
import { FaxPage } from "./fax-page"

export function FaxView({ inbox }: { inbox: InboxSummary | null }) {
  const { itemId } = useParams()
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const [q, setQ] = React.useState("")
  const query = React.useDeferredValue(q)
  const [sending, setSending] = React.useState({ open: false, n: 0 })
  const base = `/fax/${inbox?.id ?? ALL}`

  const list = useItems({ channel: "fax", inboxId: inbox?.id, q: query })
  const faxes = list.items as FaxDocument[]
  const selectedId = itemId ?? (!mobile ? faxes[0]?.id : undefined)
  const { data: selected } = useItem(selectedId)

  React.useEffect(() => {
    if (selected && !selected.read) void api.setItemsRead([selected.id], true)
  }, [selected])

  const listPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2">
        <InputGroup className="h-7">
          <InputGroupAddon>
            <SearchIcon className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={inbox ? "Search this line" : "Search all faxes"}
            className="text-xs"
            aria-label="Search faxes"
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
      </div>
      <VirtualList
        className="flex-1"
        label="Faxes"
        items={faxes}
        rowHeight={inbox ? 60 : 72}
        getKey={(f) => f.id}
        hasMore={list.hasMore}
        loading={list.isLoading}
        onLoadMore={list.loadMore}
        activeIndex={faxes.findIndex((f) => f.id === selectedId)}
        renderRow={(f) => (
          <FaxRow
            f={f}
            showLine={!inbox}
            active={f.id === selectedId}
            onOpen={() => navigate(`${base}/${f.id}`)}
          />
        )}
        empty={
          inbox && !query ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <PrinterIcon className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">No faxes yet</p>
              <p className="text-xs text-muted-foreground">
                Send one to{" "}
                <code className="text-foreground">{inbox.address}</code> with{" "}
                <code className="text-foreground">POST /v2/faxes</code>.
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
        {formatCount(list.total)} fax{list.total === 1 ? "" : "es"}
      </div>
    </div>
  )

  return (
    <>
      <ChannelShell
        channel="fax"
        inbox={inbox}
        hasDetail={Boolean(itemId)}
        listSize="34%"
        list={listPane}
        detail={
          selected?.channel === "fax" ? (
            <FaxDetail
              key={selected.id}
              fax={selected}
              onBack={() => navigate(base)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              No fax selected
            </div>
          )
        }
        actions={
          inbox ? (
            <>
              <Button
                size="sm"
                className="h-7 gap-1.5"
                onClick={() => setSending((s) => ({ open: true, n: s.n + 1 }))}
              >
                <SendIcon />{" "}
                <span className="hidden sm:inline">Fax your app</span>
              </Button>
              <InboxActions inbox={inbox} />
            </>
          ) : null
        }
      />
      {inbox ? (
        <SendFaxDialog
          key={sending.n}
          inbox={inbox}
          open={sending.open}
          onOpenChange={(open) => setSending((s) => ({ ...s, open }))}
          onSent={(f) => navigate(`${base}/${f.id}`)}
        />
      ) : null}
    </>
  )
}

function FaxRow({
  f,
  showLine,
  active,
  onOpen,
}: {
  f: FaxDocument
  showLine: boolean
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active || undefined}
      className={cn(
        "relative grid h-full w-full grid-cols-[0.375rem_2rem_1fr] items-center gap-x-2.5 border-b border-border/60 px-3 text-left transition-colors hover:bg-accent/60",
        active &&
          "bg-accent before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-foreground hover:bg-accent"
      )}
    >
      <UnreadDot show={!f.read} />
      <Thumb pages={f.pages} />
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "flex-1 truncate text-[13px]",
              !f.read && "font-semibold"
            )}
          >
            {f.title}
          </span>
          <Time
            iso={f.createdAt}
            className="text-[11px] text-muted-foreground"
          />
        </div>
        {showLine ? (
          <div className="truncate font-mono text-[10.5px] text-muted-foreground">
            {formatPhone(f.peerNumber)}
          </div>
        ) : null}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <DirectionTag direction={f.direction} adapterId={f.adapterId} />
          <span>{pluralize(f.pages, "page")}</span>
          {f.status === "failed" ? <StatusLabel status="failed" /> : null}
        </div>
      </div>
    </button>
  )
}

function Thumb({ pages }: { pages: number }) {
  return (
    <span className="relative block h-10 w-8" aria-hidden>
      {pages > 1 ? (
        <span className="absolute top-1 left-1 h-9 w-6 rounded-[2px] border bg-paper/70" />
      ) : null}
      <span className="absolute top-0 left-0 flex h-9 w-6 flex-col gap-[3px] rounded-[2px] border bg-paper p-1">
        <span className="h-px w-full bg-neutral-400" />
        <span className="mt-0.5 h-[3px] w-3/4 bg-neutral-700" />
        <span className="h-px w-full bg-neutral-300" />
        <span className="h-px w-5/6 bg-neutral-300" />
        <span className="h-px w-2/3 bg-neutral-300" />
      </span>
    </span>
  )
}

function FaxDetail({ fax, onBack }: { fax: FaxDocument; onBack: () => void }) {
  const [page, setPage] = React.useState(1)
  const [inspect, setInspect] = React.useState(false)
  const hooks = useWebhooksFor(fax.id).data ?? []
  const transmitted = fax.status !== "failed"

  return (
    <section className="flex h-full min-w-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Back to faxes"
          className="md:hidden"
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => toast(`Saved ${fax.title}.pdf`)}
          disabled={!transmitted}
        >
          <DownloadIcon /> PDF
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setInspect(true)}>
          Inspect record
        </Button>
        <div className="flex-1" />
        <span className="font-mono text-[11px] text-muted-foreground">
          {fax.providerId.slice(0, 8)}…
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col 2xl:flex-row">
        <ScrollArea className="min-h-0 flex-1 bg-muted/40">
          <div className="flex flex-col items-center gap-4 p-6">
            {transmitted ? (
              <>
                <FaxPage
                  fax={fax}
                  page={page}
                  className="w-full max-w-[34rem]"
                />
                {fax.pages > 1 ? (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {Array.from({ length: fax.pages }, (_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setPage(i + 1)}
                        aria-label={`Page ${i + 1}`}
                        aria-current={page === i + 1}
                        className={cn(
                          "rounded-[3px] p-0.5 ring-offset-2 ring-offset-background transition",
                          page === i + 1
                            ? "ring-2 ring-foreground"
                            : "opacity-60 hover:opacity-100"
                        )}
                      >
                        <FaxPage
                          fax={fax}
                          page={i + 1}
                          thumbnail
                          className="w-12"
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex aspect-[8.5/11] w-full max-w-[34rem] flex-col items-center justify-center gap-2 rounded-[3px] border border-dashed bg-background text-center">
                <AlertTriangleIcon className="size-5 text-destructive" />
                <p className="text-sm font-medium">Nothing arrived</p>
                <p className="max-w-64 text-xs text-muted-foreground">
                  No pages reached this line. Your app got{" "}
                  <code>fax.failed</code> with{" "}
                  <code>failure_reason: "{fax.failureReason}"</code>.
                </p>
              </div>
            )}
          </div>
        </ScrollArea>

        <aside className="shrink-0 space-y-5 border-t p-4 2xl:w-80 2xl:border-t-0 2xl:border-l">
          <div className="space-y-1">
            <h2 className="text-[15px] leading-snug font-medium">
              {fax.title}
            </h2>
            <div className="flex items-center gap-3">
              <DirectionTag
                direction={fax.direction}
                adapterId={fax.adapterId}
              />
              <StatusLabel status={fax.status} />
            </div>
          </div>
          <KeyValue
            rows={[
              [
                "From",
                <span className="font-mono text-[11px]">
                  {formatPhone(
                    fax.direction === "outbound"
                      ? fax.appNumber
                      : fax.peerNumber
                  )}
                </span>,
              ],
              [
                "To",
                <span className="font-mono text-[11px]">
                  {formatPhone(
                    fax.direction === "outbound"
                      ? fax.peerNumber
                      : fax.appNumber
                  )}
                </span>,
              ],
              ["Pages", fax.pages],
              ["Quality", fax.quality.replace("_", " ")],
              ["Sent", fullTime(fax.createdAt)],
            ]}
          />
          <section className="space-y-2">
            <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Status events
            </h3>
            <ol className="relative space-y-2.5 pl-4 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3px] before:w-px before:bg-border">
              {fax.events.map((e, i) => {
                const last = i === fax.events.length - 1
                const bad = e.event === "fax.failed"
                return (
                  <li
                    key={e.event}
                    className="relative flex items-baseline justify-between gap-2 text-xs"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-1 -left-4 size-[7px] rounded-full border bg-background",
                        last &&
                          (bad
                            ? "border-destructive bg-destructive"
                            : "border-ok bg-ok")
                      )}
                    />
                    <code
                      className={cn(
                        "text-[11px]",
                        last ? "font-medium" : "text-muted-foreground"
                      )}
                    >
                      {e.event}
                    </code>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {clockTime(e.at)}
                    </span>
                  </li>
                )
              })}
            </ol>
          </section>
          <section className="space-y-2">
            <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Webhooks
            </h3>
            {hooks.length ? (
              <ul className="space-y-1">
                {hooks.map((w) => (
                  <li key={w.id}>
                    <Link
                      to={`/webhooks?id=${w.id}`}
                      className="flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-accent"
                    >
                      <HttpCode status={w.status} />
                      <code className="min-w-0 flex-1 truncate text-[11px]">
                        {w.event}
                      </code>
                      <Time
                        iso={w.createdAt}
                        className="text-[11px] text-muted-foreground"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">None recorded.</p>
            )}
          </section>
        </aside>
      </div>

      <ItemInspector item={inspect ? fax : null} onOpenChange={setInspect} />
    </section>
  )
}

function SendFaxDialog({
  inbox,
  open,
  onOpenChange,
  onSent,
}: {
  inbox: InboxSummary
  open: boolean
  onOpenChange: (o: boolean) => void
  onSent: (f: FaxDocument) => void
}) {
  const [file, setFile] = React.useState<string | null>(null)
  const [pages, setPages] = React.useState(1)
  const [to, setTo] = React.useState("+16285550150")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fax your app</DialogTitle>
          <DialogDescription>
            Sent from{" "}
            <span className="font-mono text-foreground">
              {formatPhone(inbox.address)}
            </span>
            . Your app receives <code>fax.received</code> with a{" "}
            <code>media_url</code> it can download.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel>To</FieldLabel>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger className="w-full font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(appNumbers).map(([n, label]) => (
                  <SelectItem key={n} value={n}>
                    <span className="font-mono">{formatPhone(n)}</span>
                    <span className="text-muted-foreground">{label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="fax-file">Document</FieldLabel>
            <label
              htmlFor="fax-file"
              className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed px-4 py-6 text-center text-xs transition-colors hover:bg-accent/50"
            >
              <FileUpIcon className="size-4 text-muted-foreground" />
              {file ? (
                <span className="font-medium">{file}</span>
              ) : (
                <span>Choose a PDF or TIFF</span>
              )}
              <span className="text-[11px] text-muted-foreground">
                Rendered at 204×196 dpi, like a real fine-mode fax
              </span>
            </label>
            <input
              id="fax-file"
              type="file"
              accept="application/pdf,image/tiff"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)}
            />
          </Field>
          <Field orientation="horizontal" className="justify-between">
            <FieldLabel htmlFor="fax-pages">Pages</FieldLabel>
            <Input
              id="fax-pages"
              type="number"
              min={1}
              max={20}
              value={pages}
              onChange={(e) =>
                setPages(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
              }
              className="w-20 text-right tabular-nums"
            />
          </Field>
        </FieldGroup>
        <DialogFooter className="flex-col items-stretch gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <InboundRoute inbox={inbox} event="fax.received" urlKey="faxUrl" />
          <Button
            disabled={!file}
            onClick={() => {
              void api
                .sendFaxToApp({
                  inbox,
                  appNumber: to,
                  title: file!.replace(/\.\w+$/i, ""),
                  pages,
                })
                .then(onSent)
              onOpenChange(false)
              toast.success("Delivered to your app", {
                description: "fax.received → 200 OK",
              })
            }}
          >
            Send fax
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
