import { toast } from "sonner"
import { DownloadIcon, UploadIcon } from "lucide-react"
import { adapters } from "@/adapters"
import * as React from "react"
import { api } from "@/api/client"
import { useChannelStats, useDataset } from "@/api/hooks"
import type { Dataset } from "@/api/types"
import { SIZES } from "@/mocks/generate"
import { formatCount } from "@/channels/inbox-pane"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

export function SettingsPage() {
  const stats = useChannelStats().data ?? []
  const total = stats.reduce((n, s) => n + s.items, 0)
  const inboxes = stats.reduce((n, s) => n + s.inboxes, 0)
  const serverDataset = useDataset().data
  const [picked, setDataset] = React.useState<Dataset | null>(null)
  const dataset = picked ?? serverDataset ?? "small"

  return (
    <>
      <PageHeader
        title="Settings"
        meta="Written to phonybox.config.ts when you save"
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-2xl space-y-10 px-4 py-6 sm:px-6">
          <Section title="Server">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="host">Host</FieldLabel>
                <FieldDescription>
                  Use 0.0.0.0 to reach it from containers or a phone on your
                  network.
                </FieldDescription>
              </FieldContent>
              <Input
                id="host"
                defaultValue="127.0.0.1"
                className="w-36 font-mono text-xs"
              />
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="port">UI and control API port</FieldLabel>
              </FieldContent>
              <Input
                id="port"
                defaultValue="4100"
                className="w-36 font-mono text-xs"
              />
            </Field>
            <div className="rounded-md border text-xs">
              {adapters.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between border-b px-3 py-2 last:border-b-0"
                >
                  <span>{a.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    :{a.port}
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Inboxes">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="autocreate">
                  Create inboxes on first message
                </FieldLabel>
                <FieldDescription>
                  Mail to an unknown address gets its own inbox. Off sends it to
                  the catch-all.
                </FieldDescription>
              </FieldContent>
              <Switch id="autocreate" />
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>Keep per inbox</FieldLabel>
                <FieldDescription>
                  Oldest messages are dropped past this.
                </FieldDescription>
              </FieldContent>
              <Select defaultValue="500">
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="100">100 messages</SelectItem>
                  <SelectItem value="500">500 messages</SelectItem>
                  <SelectItem value="0">Everything</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>Delete agent inboxes idle for</FieldLabel>
                <FieldDescription>
                  Agents create an inbox per run, so they pile up. Inboxes you
                  made or pinned are never removed.
                </FieldDescription>
              </FieldContent>
              <Select defaultValue="7d">
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never</SelectItem>
                  <SelectItem value="24h">24 hours</SelectItem>
                  <SelectItem value="7d">7 days</SelectItem>
                  <SelectItem value="30d">30 days</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </Section>

          <Section title="Seed data">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>Start with</FieldLabel>
                <FieldDescription>
                  The load-test seed is shaped like real agent runs, so you can
                  see how the UI behaves with thousands of inboxes.
                </FieldDescription>
              </FieldContent>
              <Select
                value={dataset}
                onValueChange={(v) => {
                  setDataset(v as Dataset)
                  void api.reset(v as Dataset)
                  toast(
                    v === "large"
                      ? "Loaded the load-test seed"
                      : "Loaded the hand-written seed"
                  )
                }}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="large">
                    Load test ·{" "}
                    {formatCount(SIZES.email + SIZES.sms + SIZES.fax + 8)}{" "}
                    inboxes
                  </SelectItem>
                  <SelectItem value="small">
                    Hand-written · 8 inboxes
                  </SelectItem>
                  <SelectItem value="empty">Empty · catch-all only</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </Section>

          <Section title="Webhook delivery">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>Retries</FieldLabel>
                <FieldDescription>
                  "Provider" mirrors each adapter's real schedule, compressed to
                  seconds.
                </FieldDescription>
              </FieldContent>
              <Select defaultValue="provider">
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="provider">Provider</SelectItem>
                  <SelectItem value="none">No retries</SelectItem>
                  <SelectItem value="3x">3 tries, 2s apart</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="timeout">Timeout</FieldLabel>
              </FieldContent>
              <Input
                id="timeout"
                defaultValue="10s"
                className="w-36 font-mono text-xs"
              />
            </Field>
          </Section>

          <Section title="Storage">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel>Persist state</FieldLabel>
                <FieldDescription>
                  In memory resets on restart, which is what most test runs
                  want.
                </FieldDescription>
              </FieldContent>
              <Select defaultValue="memory">
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="memory">In memory</SelectItem>
                  <SelectItem value="file">.phonybox/</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => toast("Exported state.json")}
              >
                <DownloadIcon /> Export state
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => toast("Choose a seed file…")}
              >
                <UploadIcon /> Load seed file
              </Button>
            </div>
          </Section>

          <section className="space-y-3 rounded-md border border-destructive/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <h2 className="text-[13px] font-medium">Reset everything</h2>
                <p className="text-xs text-muted-foreground">
                  Deletes {formatCount(inboxes)} inboxes, {formatCount(total)}{" "}
                  messages and every webhook and API log, then reloads the seed.
                  Same as{" "}
                  <code className="text-foreground">POST /api/reset</code>.
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => {
                  void api.reset(dataset)
                  toast("State reset to seed")
                }}
              >
                Reset
              </Button>
            </div>
          </section>
        </div>
      </ScrollArea>
    </>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-[13px] font-medium">{title}</h2>
      <FieldSeparator className="-mt-2" />
      <FieldGroup className="gap-5">{children}</FieldGroup>
    </section>
  )
}
