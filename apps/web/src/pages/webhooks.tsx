import * as React from "react"
import { useSearchParams } from "react-router"
import { toast } from "sonner"
import { RotateCwIcon, SearchIcon, TerminalIcon, XIcon } from "lucide-react"
import { adapters, getAdapter } from "@/adapters"
import { api } from "@/api/client"
import { useWebhook, useWebhookTargets, useWebhooks } from "@/api/hooks"
import { fullTime } from "@/lib/format"
import { formatCount } from "@/channels/inbox-pane"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/layout/page-header"
import { VirtualList } from "@/components/virtual-list"
import {
  AdapterMark,
  CodeBlock,
  HttpCode,
  KeyValue,
  Time,
} from "@/components/bits"
import { Button } from "@/components/ui/button"
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const GRID =
  "grid grid-cols-[4rem_minmax(0,1fr)_3rem_3.5rem] md:grid-cols-[4rem_14rem_minmax(0,1fr)_3rem_4rem_3.5rem] items-center"

export function WebhooksPage() {
  const [params, setParams] = useSearchParams()
  const [adapter, setAdapter] = React.useState("all")
  const [only, setOnly] = React.useState<"all" | "failed">("all")
  const [q, setQ] = React.useState("")
  const query = React.useDeferredValue(q)
  const openId = params.get("id")
  const list = useWebhooks({
    adapterId: adapter === "all" ? undefined : adapter,
    failedOnly: only === "failed",
    q: query,
  })
  const targets = useWebhookTargets().data ?? []

  return (
    <>
      <PageHeader
        title="Webhooks"
        meta="Every request the emulator made to your app"
      />

      <section className="border-b px-4 py-3">
        <h2 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Targets
        </h2>
        <ul className="grid gap-x-6 gap-y-1.5 lg:grid-cols-2">
          {targets.map((t) => (
            <li
              key={t.url}
              className="flex min-w-0 items-center gap-2.5 text-xs"
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  t.lastStatus !== null && t.lastStatus < 400
                    ? "bg-ok"
                    : "bg-destructive"
                )}
              />
              <AdapterMark id={t.adapterId} className="size-4 text-[9px]" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                {t.url.replace(/^https?:\/\//, "")}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {t.failed ? (
                  <span className="text-destructive">
                    {formatCount(t.failed)} failed ·{" "}
                  </span>
                ) : null}
                {formatCount(t.total)} sent
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <InputGroup className="h-7 w-full sm:w-64">
          <InputGroupAddon>
            <SearchIcon className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Event, URL or error"
            className="text-xs"
            aria-label="Search webhooks"
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
        <Select value={adapter} onValueChange={setAdapter}>
          <SelectTrigger
            size="sm"
            className="h-7 w-32 text-xs"
            aria-label="Adapter"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All adapters</SelectItem>
            {adapters.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={only}
          onValueChange={(v) => v && setOnly(v as typeof only)}
        >
          <ToggleGroupItem value="all" className="px-2 text-[11px]">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="failed" className="px-2 text-[11px]">
            Failed
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {formatCount(list.total)} deliveries
        </span>
      </div>

      <VirtualList
        className="flex-1"
        label="Webhook deliveries"
        items={list.items}
        rowHeight={36}
        getKey={(w) => w.id}
        hasMore={list.hasMore}
        loading={list.isLoading}
        onLoadMore={list.loadMore}
        header={
          <div
            className={cn(
              GRID,
              "sticky top-0 z-10 h-8 border-b bg-background px-4 text-[11px] font-medium text-muted-foreground"
            )}
          >
            <span>Status</span>
            <span>Event</span>
            <span className="hidden md:block">Target</span>
            <span className="text-right">Try</span>
            <span className="hidden text-right md:block">Time</span>
            <span className="text-right">When</span>
          </div>
        }
        renderRow={(w) => (
          <button
            type="button"
            onClick={() => setParams({ id: w.id })}
            className={cn(
              GRID,
              "h-full w-full border-b border-border/60 px-4 text-left text-xs transition-colors hover:bg-accent/50",
              openId === w.id && "bg-accent"
            )}
          >
            <span>
              <HttpCode status={w.status} />
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <AdapterMark id={w.adapterId} className="size-4 text-[9px]" />
              <code className="truncate text-[11.5px] font-medium">
                {w.event}
              </code>
            </span>
            <span
              className={cn(
                "hidden truncate pr-4 font-mono text-[11px] md:block",
                w.error ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {w.error ?? w.url.replace(/^https?:\/\//, "")}
            </span>
            <span className="text-right text-muted-foreground tabular-nums">
              {w.attempt}/{w.maxAttempts}
            </span>
            <span className="hidden text-right text-muted-foreground tabular-nums md:block">
              {w.durationMs}ms
            </span>
            <span className="text-right text-muted-foreground">
              <Time iso={w.createdAt} />
            </span>
          </button>
        )}
        empty={
          <p className="py-12 text-center text-xs text-muted-foreground">
            No deliveries match.
          </p>
        }
      />

      <WebhookSheet id={openId} onClose={() => setParams({})} />
    </>
  )
}

function WebhookSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const { data: w } = useWebhook(id)
  return (
    <Sheet open={Boolean(id && w)} onOpenChange={(o) => !o && onClose()}>
      {w ? (
        <SheetContent
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-full gap-0 p-0 sm:max-w-xl"
        >
          <SheetHeader className="gap-1.5 border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <HttpCode status={w.status} />
              <code>{w.event}</code>
            </SheetTitle>
            <SheetDescription className="truncate font-mono text-[11px]">
              POST {w.url}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="space-y-4 p-4">
              <KeyValue
                rows={[
                  [
                    "Adapter",
                    <span className="inline-flex items-center gap-1.5">
                      <AdapterMark
                        id={w.adapterId}
                        className="size-4 text-[9px]"
                      />
                      {getAdapter(w.adapterId)?.name}
                    </span>,
                  ],
                  ["Attempt", `${w.attempt} of ${w.maxAttempts}`],
                  ["Duration", `${w.durationMs} ms`],
                  ["Sent", fullTime(w.createdAt)],
                ]}
              />
              {w.error ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-[11px] text-destructive">
                  {w.error}
                </p>
              ) : null}
              <Tabs defaultValue="request" className="gap-3">
                <TabsList variant="line" className="h-8 border-b">
                  <TabsTrigger value="request">Request</TabsTrigger>
                  <TabsTrigger value="response">Response</TabsTrigger>
                </TabsList>
                <TabsContent value="request" className="space-y-3">
                  <CodeBlock
                    title="headers"
                    code={w.requestHeaders
                      .map(([k, v]) => `${k}: ${v}`)
                      .join("\n")}
                    wrap
                  />
                  <CodeBlock title="body" code={w.requestBody} />
                </TabsContent>
                <TabsContent value="response">
                  {w.status === null ? (
                    <p className="text-xs text-muted-foreground">
                      No response. The connection was refused before a request
                      was sent.
                    </p>
                  ) : (
                    <CodeBlock
                      title={`${w.status} · ${w.durationMs} ms`}
                      code={w.responseBody ?? ""}
                      wrap
                    />
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>
          <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                const h = w.requestHeaders
                  .map(([k, v]) => `-H '${k}: ${v}'`)
                  .join(" \\\n  ")
                void navigator.clipboard?.writeText(
                  `curl -X POST '${w.url}' \\\n  ${h} \\\n  --data-raw '${w.requestBody}'`
                )
                toast("Copied as cURL")
              }}
            >
              <TerminalIcon /> Copy as cURL
            </Button>
            <Button
              className="gap-1.5"
              onClick={() => {
                void api.replayWebhook(w.id)
                toast.success("Replayed", {
                  description: `${w.event} → 200 OK`,
                })
              }}
            >
              <RotateCwIcon /> Replay
            </Button>
          </SheetFooter>
        </SheetContent>
      ) : null}
    </Sheet>
  )
}
