import * as React from "react"
import { Navigate, useParams, useSearchParams } from "react-router"
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  EyeIcon,
  EyeOffIcon,
  ExternalLinkIcon,
} from "lucide-react"
import { adapterBaseUrl, getAdapter, type AdapterDefinition } from "@/adapters"
import type { SettingSpec, Support } from "@/adapters/define"
import { api } from "@/api/client"
import { useAdapterStates } from "@/api/hooks"
import { getChannel } from "@/channels/meta"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/layout/page-header"
import { AdapterMark, CodeBlock, CopyButton } from "@/components/bits"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function AdapterDetailPage() {
  const { adapterId } = useParams()
  const [params, setParams] = useSearchParams()
  const states = useAdapterStates()
  const adapter = getAdapter(adapterId ?? "")
  if (!adapter) return <Navigate to="/adapters" replace />

  const s = states[adapter.id] ?? { enabled: false, values: {} }
  const tab = params.get("tab") ?? "connect"

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <AdapterMark id={adapter.id} />
            {adapter.name}
          </span>
        }
        meta={<span className="font-mono">{adapterBaseUrl(adapter)}</span>}
      >
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {s.enabled ? "On" : "Off"}
          <Switch
            checked={s.enabled}
            onCheckedChange={(v) =>
              void api.setAdapter(adapter.id, { enabled: v })
            }
            aria-label="Enabled"
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="hidden gap-1.5 sm:inline-flex"
        >
          <a href={adapter.docsUrl} target="_blank" rel="noreferrer">
            Provider docs <ExternalLinkIcon />
          </a>
        </Button>
      </PageHeader>

      <Tabs
        value={tab}
        onValueChange={(v) => setParams({ tab: v })}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="border-b px-4 sm:px-6">
          <TabsList variant="line" className="h-10">
            <TabsTrigger value="connect">Connect</TabsTrigger>
            <TabsTrigger value="outbound" className="gap-1.5">
              <ArrowUpRightIcon />
              Outbound
            </TabsTrigger>
            <TabsTrigger value="inbound" className="gap-1.5">
              <ArrowDownLeftIcon />
              Inbound
            </TabsTrigger>
            <TabsTrigger value="faults">Faults</TabsTrigger>
            <TabsTrigger value="auth">Keys</TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
            <TabsContent value="connect">
              <ConnectTab adapter={adapter} />
            </TabsContent>
            <TabsContent value="outbound">
              <OutboundTab adapter={adapter} />
            </TabsContent>
            <TabsContent value="inbound">
              <InboundTab adapter={adapter} />
            </TabsContent>
            <TabsContent value="faults">
              <FaultsTab adapter={adapter} />
            </TabsContent>
            <TabsContent value="auth">
              <SettingsGroup adapter={adapter} group="auth" />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </>
  )
}

/* ---------------------------------------------------------------- connect */

function ConnectTab({ adapter }: { adapter: AdapterDefinition }) {
  const url = adapterBaseUrl(adapter)
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.5fr]">
      <div className="space-y-4 text-xs leading-relaxed">
        <p className="text-muted-foreground">{adapter.description}</p>
        <ol className="space-y-3">
          <Step n={1} title="Point the SDK here">
            Set the base URL to <code className="text-foreground">{url}</code>.
            Nothing else in your code changes.
          </Step>
          <Step n={2} title="Use the local keys">
            Any key is accepted by default. Turn that off under Keys to test 401
            handling.
          </Step>
          <Step n={3} title="Expose your webhook routes">
            Inbound messages and status events are POSTed to the URLs under
            Inbound.
          </Step>
        </ol>
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <span className="text-muted-foreground">Base URL</span>
          <span className="inline-flex items-center gap-1 font-mono text-[11px]">
            {url}
            <CopyButton value={url} />
          </span>
        </div>
      </div>
      <Tabs defaultValue={adapter.connect[0].label} className="gap-0">
        <TabsList className="mb-2">
          {adapter.connect.map((c) => (
            <TabsTrigger
              key={c.label}
              value={c.label}
              className="px-2.5 font-mono text-[11px]"
            >
              {c.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {adapter.connect.map((c) => (
          <TabsContent key={c.label} value={c.label}>
            <CodeBlock code={c.code} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="grid grid-cols-[1.25rem_1fr] gap-x-2">
      <span className="flex size-5 items-center justify-center rounded-full border font-mono text-[10px] text-muted-foreground">
        {n}
      </span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{children}</p>
      </div>
    </li>
  )
}

/* --------------------------------------------------------------- outbound */

const supportCopy: Record<Support, { label: string; className: string }> = {
  full: { label: "Full", className: "text-[color:var(--ok)]" },
  partial: { label: "Partial", className: "text-[color:var(--warn)]" },
  planned: { label: "Planned", className: "text-muted-foreground" },
}

function OutboundTab({ adapter }: { adapter: AdapterDefinition }) {
  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <SectionTitle
          title="Emulated API"
          hint="What your app can call. Unknown routes return the provider's own 404 shape so failures look real."
        />
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-xs">
            <tbody className="divide-y">
              {adapter.outbound.map((e) => (
                <tr
                  key={e.method + e.path}
                  className={cn(
                    e.support === "planned" && "text-muted-foreground"
                  )}
                >
                  <td className="w-16 py-2 pl-3 font-mono text-[11px] font-medium">
                    {e.method}
                  </td>
                  <td className="py-2 font-mono text-[11.5px]">{e.path}</td>
                  <td className="hidden py-2 text-muted-foreground md:table-cell">
                    {e.summary}
                  </td>
                  <td className="hidden w-20 py-2 text-[11px] text-muted-foreground sm:table-cell">
                    {getChannel(e.channel).label}
                  </td>
                  <td
                    className={cn(
                      "w-20 py-2 pr-3 text-right text-[11px] font-medium",
                      supportCopy[e.support].className
                    )}
                  >
                    {supportCopy[e.support].label}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <SettingsGroup adapter={adapter} group="outbound" />
    </div>
  )
}

/* ---------------------------------------------------------------- inbound */

function InboundTab({ adapter }: { adapter: AdapterDefinition }) {
  const values = useAdapterStates()[adapter.id]?.values ?? {}
  return (
    <div className="space-y-8">
      <SettingsGroup adapter={adapter} group="inbound" />
      <section className="space-y-2">
        <SectionTitle
          title="Events"
          hint="When each webhook fires, and where it goes."
        />
        <ul className="divide-y overflow-hidden rounded-md border">
          {adapter.inbound.map((e) => (
            <li
              key={e.event}
              className="grid gap-1 px-3 py-2.5 text-xs sm:grid-cols-[11rem_1fr_auto] sm:items-center sm:gap-4"
            >
              <code className="text-[11.5px] font-medium">{e.event}</code>
              <span className="text-muted-foreground">{e.trigger}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground sm:max-w-56">
                {String(values[e.urlSetting] || "not set").replace(
                  /^https?:\/\/localhost:\d+/,
                  ""
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/* ----------------------------------------------------------------- faults */

function FaultsTab({ adapter }: { adapter: AdapterDefinition }) {
  const [latency, setLatency] = React.useState([0])
  const [errorRate, setErrorRate] = React.useState([0])
  const rules =
    adapter.id === "mailgun"
      ? [
          {
            id: "bounce-billing",
            when: "to = agent-2@inbox.test and tag = dunning",
            then: "permanent_fail, 550 5.1.1",
            on: true,
          },
          {
            id: "slow-digest",
            when: "tag = digest",
            then: "delay delivery 30s",
            on: false,
          },
        ]
      : [
          {
            id: "busy-records",
            when: "fax to +1 (212) 555-0199, first attempt",
            then: "fax.failed, user_busy",
            on: true,
          },
          {
            id: "carrier-reject",
            when: 'sms body contains "bit.ly"',
            then: "message.finalized, 40008 spam",
            on: false,
          },
        ]

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <SectionTitle
          title="Rules"
          hint="Make specific messages fail the way the real provider would. Matched top to bottom."
        />
        <ul className="divide-y overflow-hidden rounded-md border">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-4 px-3 py-2.5">
              <div className="min-w-0 flex-1 space-y-0.5 text-xs">
                <code className="text-[11.5px] font-medium">{r.id}</code>
                <p className="text-muted-foreground">
                  When <span className="text-foreground">{r.when}</span> →{" "}
                  {r.then}
                </p>
              </div>
              <Switch defaultChecked={r.on} aria-label={`${r.id} enabled`} />
            </li>
          ))}
        </ul>
        <Button variant="outline" size="sm">
          Add rule
        </Button>
      </section>

      <section className="space-y-4">
        <SectionTitle
          title="Whole adapter"
          hint="Applies to every API call your app makes."
        />
        <FieldGroup className="gap-6">
          <Field>
            <div className="flex items-baseline justify-between">
              <FieldLabel>Added latency</FieldLabel>
              <span className="font-mono text-xs tabular-nums">
                {latency[0]} ms
              </span>
            </div>
            <Slider
              value={latency}
              onValueChange={setLatency}
              max={3000}
              step={50}
            />
          </Field>
          <Field>
            <div className="flex items-baseline justify-between">
              <FieldLabel>Random 5xx rate</FieldLabel>
              <span className="font-mono text-xs tabular-nums">
                {errorRate[0]}%
              </span>
            </div>
            <Slider
              value={errorRate}
              onValueChange={setErrorRate}
              max={50}
              step={1}
            />
            <FieldDescription>
              Returns the provider's real 500/503 body so retry logic gets
              exercised.
            </FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel>Rate limit</FieldLabel>
              <FieldDescription>
                Respond 429 with Retry-After once requests exceed the provider's
                published limit.
              </FieldDescription>
            </FieldContent>
            <Switch aria-label="Rate limit" />
          </Field>
        </FieldGroup>
      </section>
    </div>
  )
}

/* ------------------------------------------------------- generated fields */

function SettingsGroup({
  adapter,
  group,
}: {
  adapter: AdapterDefinition
  group: SettingSpec["group"]
}) {
  const fields = adapter.settings.filter((s) => s.group === group)
  if (!fields.length) return null
  const titles = {
    inbound: "Webhook targets",
    outbound: "Sending",
    auth: "Keys",
  } as const
  return (
    <section className="space-y-3">
      <SectionTitle
        title={titles[group]}
        hint={
          group === "inbound"
            ? "Your app's routes. Usually localhost."
            : undefined
        }
      />
      <FieldGroup className="gap-5">
        {fields.map((f) => (
          <SettingField key={f.key} adapterId={adapter.id} spec={f} />
        ))}
      </FieldGroup>
    </section>
  )
}

function SettingField({
  adapterId,
  spec,
}: {
  adapterId: string
  spec: SettingSpec
}) {
  const value =
    useAdapterStates()[adapterId]?.values[spec.key] ?? spec.defaultValue
  const [reveal, setReveal] = React.useState(false)
  const id = `${adapterId}-${spec.key}`

  if (spec.kind === "toggle") {
    return (
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor={id}>{spec.label}</FieldLabel>
          {spec.description ? (
            <FieldDescription>{spec.description}</FieldDescription>
          ) : null}
        </FieldContent>
        <Switch
          id={id}
          checked={Boolean(value)}
          onCheckedChange={(v) =>
            void api.setAdapterValue(adapterId, spec.key, v)
          }
        />
      </Field>
    )
  }

  if (spec.kind === "secret") {
    return (
      <Field>
        <FieldLabel htmlFor={id}>{spec.label}</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={id}
            readOnly
            value={reveal ? String(value) : "•".repeat(18)}
            className="font-mono text-xs"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={reveal ? "Hide" : "Reveal"}
              onClick={() => setReveal((r) => !r)}
            >
              {reveal ? <EyeOffIcon /> : <EyeIcon />}
            </InputGroupButton>
            <CopyButton value={String(value)} />
          </InputGroupAddon>
        </InputGroup>
        {spec.description ? (
          <FieldDescription>{spec.description}</FieldDescription>
        ) : null}
      </Field>
    )
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>{spec.label}</FieldLabel>
      <Input
        id={id}
        value={String(value)}
        placeholder={
          spec.kind === "url" ? "http://localhost:3000/…" : undefined
        }
        onChange={(e) =>
          void api.setAdapterValue(adapterId, spec.key, e.target.value)
        }
        className={cn(
          spec.kind !== "text" || /[@+_(]/.test(String(value))
            ? "font-mono text-xs"
            : ""
        )}
        spellCheck={false}
      />
      {spec.description ? (
        <FieldDescription>{spec.description}</FieldDescription>
      ) : null}
    </Field>
  )
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="space-y-0.5">
      <h2 className="text-[13px] font-medium">{title}</h2>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
