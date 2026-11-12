import { Link } from "react-router"
import { ChevronRightIcon } from "lucide-react"
import { adapters, adapterBaseUrl, plannedAdapters } from "@/adapters"
import { api } from "@/api/client"
import { useAdapterStates } from "@/api/hooks"
import { getChannel } from "@/channels/meta"
import { PageHeader } from "@/components/layout/page-header"
import { AdapterMark, CodeBlock, CopyButton } from "@/components/bits"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"

const scaffold = `// packages/adapter-postmark/src/index.ts
import { defineAdapter } from "@phonybox/core"

export default defineAdapter({
  id: "postmark",
  name: "Postmark",
  channels: ["email"],
  port: 4103,

  // Outbound: the API your app calls.
  outbound(app, ctx) {
    app.post("/email", async (req) => {
      const msg = await ctx.capture.email({
        from: req.body.From,
        to: req.body.To,
        subject: req.body.Subject,
        html: req.body.HtmlBody,
      })
      return { MessageID: msg.id, ErrorCode: 0, Message: "OK" }
    })
  },

  // Inbound: what your app receives when an inbox sends something.
  inbound: {
    "email.received": (msg) => ({
      url: ctx.settings.inboundUrl,
      body: toPostmarkInboundJson(msg),
    }),
  },
})`

export function AdaptersPage() {
  const states = useAdapterStates()

  return (
    <>
      <PageHeader
        title="Adapters"
        meta="One per provider. Each listens on its own port."
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6">
          <section>
            <h2 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Installed
            </h2>
            <ul className="divide-y overflow-hidden rounded-md border bg-card">
              {adapters.map((a) => {
                const s = states[a.id] ?? { enabled: false, values: {} }
                const url = adapterBaseUrl(a)
                return (
                  <li
                    key={a.id}
                    className="group relative flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-accent/40"
                  >
                    <AdapterMark
                      id={a.id}
                      className="mt-0.5 size-8 text-[12px]"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/adapters/${a.id}`}
                          className="text-sm font-medium after:absolute after:inset-0"
                        >
                          {a.name}
                        </Link>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          v{a.version}
                        </span>
                        {!s.enabled ? (
                          <span className="rounded-[4px] border px-1.5 text-[10.5px] text-muted-foreground">
                            Off
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {a.description}
                      </p>
                      <div className="relative z-10 flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[11px] text-muted-foreground">
                        <span className="text-foreground/80">
                          {a.channels
                            .map((c) => getChannel(c).label)
                            .join(" + ")}
                        </span>
                        <span className="inline-flex items-center gap-0.5 font-mono">
                          {url}
                          <CopyButton value={url} label="Copy base URL" />
                        </span>
                        <span>
                          {
                            a.outbound.filter((e) => e.support !== "planned")
                              .length
                          }{" "}
                          endpoints
                        </span>
                        <span>{a.inbound.length} webhook events</span>
                      </div>
                    </div>
                    <div className="relative z-10 flex items-center gap-3 self-center">
                      <Switch
                        checked={s.enabled}
                        onCheckedChange={(v) =>
                          void api.setAdapter(a.id, { enabled: v })
                        }
                        aria-label={`${a.name} enabled`}
                      />
                      <ChevronRightIcon className="size-4 text-muted-foreground" />
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>

          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Not built yet
              </h2>
              <span className="text-[11px] text-muted-foreground">
                Same contract, different payloads
              </span>
            </div>
            <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3">
              {plannedAdapters.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2.5 bg-background px-3 py-2.5"
                >
                  <span className="inline-flex size-6 items-center justify-center rounded-[4px] border border-dashed font-mono text-[10px] text-muted-foreground">
                    {p.monogram}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs">{p.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {p.channels.map((c) => getChannel(c).label).join(", ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              <h2 className="text-[11px] font-medium tracking-wide uppercase">
                Writing an adapter
              </h2>
              <p>
                An adapter is a package with two halves.{" "}
                <span className="text-foreground">Outbound</span> handlers
                accept the provider's API calls and hand messages to the store.{" "}
                <span className="text-foreground">Inbound</span> builders turn a
                message from an inbox into the provider's webhook.
              </p>
              <p>
                Inboxes, the viewer, webhook retries, signing and this UI come
                from core. The manifest drives the settings form, the endpoint
                list and the connect snippets on the adapter's page.
              </p>
              <code className="block pt-1 text-foreground">
                pnpm create @phonybox/adapter postmark
              </code>
            </div>
            <CodeBlock code={scaffold} title="adapter-postmark/src/index.ts" />
          </section>
        </div>
      </ScrollArea>
    </>
  )
}
