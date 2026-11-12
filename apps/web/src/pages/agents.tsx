import { PageHeader } from "@/components/layout/page-header"
import { CodeBlock } from "@/components/bits"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// Served by Phonybox itself (or Vite in development, which proxies /api and /mcp to it).
const origin =
  typeof window === "undefined"
    ? "http://127.0.0.1:4100"
    : window.location.origin
const mcpUrl = `${origin}/mcp`

const setups: { id: string; label: string; code: string; note: string }[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    code: `claude mcp add --transport http phonybox ${mcpUrl}`,
    note: "Run in your project. Add --scope project to share it through .mcp.json.",
  },
  {
    id: "json",
    label: ".mcp.json",
    code: JSON.stringify(
      { mcpServers: { phonybox: { type: "http", url: mcpUrl } } },
      null,
      2
    ),
    note: "For Claude Code, Cursor and other clients that speak MCP over HTTP.",
  },
  {
    id: "stdio",
    label: "stdio",
    code: JSON.stringify(
      {
        mcpServers: {
          phonybox: {
            command: "uvx",
            args: [
              "--from",
              "git+https://github.com/rohitlavu11/phonybox#subdirectory=apps/server",
              "phonybox",
              "mcp",
              "--url",
              origin,
            ],
          },
        },
      },
      null,
      2
    ),
    note: "For clients that only launch a command, like Claude Desktop. Needs uv.",
  },
]

const flow = `API=${origin}/api

# 1. A fresh inbox per run, so parallel agents never read each other's mail
INBOX=$(curl -s -X POST $API/inboxes -H 'content-type: application/json' \\
  -d '{"channel":"email","tags":["run:42"]}' | jq -r .address)

# 2. Sign up in your app with $INBOX (browser agent, Playwright, etc.)

# 3. Block until the confirmation arrives, then take the code
curl -s "$API/inboxes/$INBOX/wait?timeout=30&subject=confirm" | jq -r '.extract.codes[0]'
# => 482913

# 4. Clean up the run
curl -s -X POST $API/inboxes/bulk -H 'content-type: application/json' \\
  -d '{"op":"delete","query":{"q":"tag:run:42"},"except":[]}'`

const tools: [string[], string][] = [
  [
    ["get_setup"],
    "Provider base URLs, SDK setup, keys and webhook URLs, to check your app points here.",
  ],
  [
    ["create_inbox"],
    "A fresh email address or phone number for a test run, tagged for cleanup.",
  ],
  [
    ["wait_for_message"],
    "Waits for the email, text or fax your app sends. Returns codes, and links with their link text.",
  ],
  [["list_messages", "read_message"], "An inbox's messages, and one in full."],
  [
    ["send_email_to_app", "send_sms_to_app", "send_fax_to_app"],
    "Reply as the person. Returns how your webhook handler responded.",
  ],
  [
    ["list_webhook_deliveries", "get_webhook_delivery", "replay_webhook"],
    "Every delivery to your app, the exact signed request, and a replay after you fix a handler.",
  ],
  [
    ["list_api_requests"],
    "What your app sent to the provider APIs, and what it got back.",
  ],
  [
    ["configure_provider"],
    "Point webhooks at your app's port, or make deliveries fail on purpose.",
  ],
  [
    ["list_inboxes", "delete_inboxes"],
    "Find inboxes, and clean up a run by tag.",
  ],
]

const rest: [string, string, string][] = [
  ["POST", "/api/inboxes", "Create an inbox"],
  ["GET", "/api/inboxes/:id/wait", "Long-poll for the next message"],
  ["GET", "/api/inboxes/:id/messages", "List messages"],
  ["GET", "/api/items/:id", "One message in full"],
  ["GET", "/api/items/:id/extract", "Codes and links"],
  ["POST", "/api/inboxes/:id/send", "Send to the app (inbound webhook)"],
  ["GET", "/api/webhooks", "Delivery log"],
  ["POST", "/api/inboxes/bulk", "Delete a run's inboxes by tag"],
  ["POST", "/api/reset", "Back to a seed"],
]

export function AgentsPage() {
  return (
    <>
      <PageHeader
        title="Agent access"
        meta="The same inboxes, over MCP or plain HTTP"
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-4xl space-y-10 px-4 py-6 sm:px-6">
          <section className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
            <div className="space-y-2 text-xs leading-relaxed">
              <h2 className="text-[13px] font-medium">MCP server</h2>
              <p className="text-muted-foreground">
                This Phonybox serves MCP at{" "}
                <code className="text-foreground">{mcpUrl}</code>. Connect
                Claude Code or another agent and it can create inboxes, use them
                in your product, read the codes and links your app sends, and
                reply as the person. Anything it does shows up here live.
              </p>
              <p className="text-muted-foreground">
                <a
                  className="text-foreground underline underline-offset-2"
                  href="https://rohitlavu11.github.io/phonybox/guide/mcp"
                  target="_blank"
                  rel="noreferrer"
                >
                  MCP guide
                </a>
              </p>
            </div>
            <Tabs defaultValue={setups[0].id} className="gap-0">
              <TabsList className="mb-2">
                {setups.map((s) => (
                  <TabsTrigger
                    key={s.id}
                    value={s.id}
                    className="px-2.5 font-mono text-[11px]"
                  >
                    {s.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {setups.map((s) => (
                <TabsContent key={s.id} value={s.id} className="space-y-1.5">
                  <CodeBlock code={s.code} wrap />
                  <p className="text-[11px] text-muted-foreground">{s.note}</p>
                </TabsContent>
              ))}
            </Tabs>
            <dl className="grid gap-x-8 border-t text-xs lg:col-span-2 lg:grid-cols-2">
              {tools.map(([names, desc]) => (
                <div
                  key={names[0]}
                  className="grid grid-cols-[11rem_1fr] gap-3 border-b py-2"
                >
                  <dt className="flex flex-col gap-0.5">
                    {names.map((name) => (
                      <code key={name} className="text-[11.5px] font-medium">
                        {name}
                      </code>
                    ))}
                  </dt>
                  <dd className="text-muted-foreground">{desc}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
            <div className="space-y-2 text-xs leading-relaxed">
              <h2 className="text-[13px] font-medium">HTTP API</h2>
              <p className="text-muted-foreground">
                For test runners and scripts.{" "}
                <code className="text-foreground">:id</code> accepts the inbox
                id or its address, so you can use the email or phone number
                directly.
              </p>
              <table className="mt-2 w-full">
                <tbody className="divide-y">
                  {rest.map(([m, p, d]) => (
                    <tr key={m + p}>
                      <td className="w-14 py-1.5 font-mono text-[11px] font-medium text-muted-foreground">
                        {m}
                      </td>
                      <td className="py-1.5 font-mono text-[11px]">{p}</td>
                      <td className="hidden py-1.5 text-right text-muted-foreground sm:table-cell">
                        {d}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CodeBlock code={flow} title="signup-flow.sh" />
          </section>
        </div>
      </ScrollArea>
    </>
  )
}
