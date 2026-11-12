import * as React from "react"
import { Link, useSearchParams } from "react-router"
import { SearchIcon, XIcon } from "lucide-react"
import { adapters, getAdapter } from "@/adapters"
import { useItem, useRequest, useRequests } from "@/api/hooks"
import { fullTime } from "@/lib/format"
import { getChannel } from "@/channels/meta"
import { formatCount } from "@/channels/inbox-pane"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/layout/page-header"
import { VirtualList } from "@/components/virtual-list"
import {
  AdapterMark,
  CodeBlock,
  HttpCode,
  KeyValue,
  MethodTag,
  Time,
} from "@/components/bits"
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
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

const GRID =
  "grid grid-cols-[4rem_minmax(0,1fr)_3.5rem] md:grid-cols-[4rem_minmax(0,1fr)_7rem_4rem_3.5rem] items-center"

export function RequestsPage() {
  const [params, setParams] = useSearchParams()
  const [adapter, setAdapter] = React.useState("all")
  const [q, setQ] = React.useState("")
  const query = React.useDeferredValue(q)
  const openId = params.get("id")
  const list = useRequests({
    adapterId: adapter === "all" ? undefined : adapter,
    q: query,
  })

  return (
    <>
      <PageHeader
        title="API log"
        meta="Calls your app made to the emulated provider APIs"
      />
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <InputGroup className="h-7 w-full sm:w-64">
          <InputGroupAddon>
            <SearchIcon className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Path, method or status"
            className="text-xs"
            aria-label="Search requests"
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
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {formatCount(list.total)} requests
        </span>
      </div>

      <VirtualList
        className="flex-1"
        label="API requests"
        items={list.items}
        rowHeight={36}
        getKey={(r) => r.id}
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
            <span>Request</span>
            <span className="hidden md:block">Adapter</span>
            <span className="hidden text-right md:block">Time</span>
            <span className="text-right">When</span>
          </div>
        }
        renderRow={(r) => (
          <button
            type="button"
            onClick={() => setParams({ id: r.id })}
            className={cn(
              GRID,
              "h-full w-full border-b border-border/60 px-4 text-left text-xs transition-colors hover:bg-accent/50",
              openId === r.id && "bg-accent"
            )}
          >
            <span>
              <HttpCode status={r.status} />
            </span>
            <span className="flex min-w-0 items-center">
              <MethodTag method={r.method} />
              <span className="truncate font-mono text-[11.5px]">{r.path}</span>
            </span>
            <span className="hidden items-center gap-1.5 text-muted-foreground md:flex">
              <AdapterMark id={r.adapterId} className="size-4 text-[9px]" />
              {getAdapter(r.adapterId)?.name}
            </span>
            <span className="hidden text-right text-muted-foreground tabular-nums md:block">
              {r.durationMs}ms
            </span>
            <span className="text-right text-muted-foreground">
              <Time iso={r.createdAt} />
            </span>
          </button>
        )}
        empty={
          <p className="py-12 text-center text-xs text-muted-foreground">
            No requests match.
          </p>
        }
      />

      <RequestSheet id={openId} onClose={() => setParams({})} />
    </>
  )
}

function RequestSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const { data: r } = useRequest(id)
  const { data: related } = useItem(r?.relatedId)
  const relatedHref = related
    ? `${getChannel(related.channel).path}/${related.inboxId}/${related.channel === "sms" ? related.appNumber.slice(1) : related.id}`
    : null

  return (
    <Sheet open={Boolean(id && r)} onOpenChange={(o) => !o && onClose()}>
      {r ? (
        <SheetContent
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-full gap-0 p-0 sm:max-w-xl"
        >
          <SheetHeader className="gap-1.5 border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <HttpCode status={r.status} />
              <span className="font-mono text-[12px]">{r.method}</span>
            </SheetTitle>
            <SheetDescription className="font-mono text-[11px] break-all">
              http://127.0.0.1:{getAdapter(r.adapterId)?.port}
              {r.path}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="space-y-4 p-4">
              <KeyValue
                rows={[
                  ["Adapter", getAdapter(r.adapterId)?.name],
                  ["Duration", `${r.durationMs} ms`],
                  ["Received", fullTime(r.createdAt)],
                  ...(related && relatedHref
                    ? ([
                        [
                          "Created",
                          <Link
                            to={relatedHref}
                            className="underline underline-offset-2"
                          >
                            {related.channel === "email"
                              ? related.subject
                              : related.channel === "fax"
                                ? related.title
                                : related.body.slice(0, 48) + "…"}
                          </Link>,
                        ],
                      ] as [string, React.ReactNode][])
                    : []),
                ]}
              />
              {r.requestBody ? (
                <CodeBlock title="request body" code={r.requestBody} wrap />
              ) : null}
              {r.responseBody ? (
                <CodeBlock
                  title={`response · ${r.status}`}
                  code={r.responseBody}
                  wrap
                />
              ) : null}
            </div>
          </div>
        </SheetContent>
      ) : null}
    </Sheet>
  )
}
