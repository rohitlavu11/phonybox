import { PageHeader } from "@/components/layout/page-header"
import { CodeBlock } from "@/components/bits"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const mcpConfig = `{
  "mcpServers": {
    "phonybox": {
      "command": "npx",
      "args": ["phonybox", "mcp", "--url", "http://127.0.0.1:4100"]
    }
  }
}`

const flow = `# 1. A fresh inbox per run, so parallel agents never read each other's mail
INBOX=$(curl -s -X POST http://127.0.0.1:4100/api/inboxes \\
  -d '{"channel":"email","label":"checkout-run-42"}' | jq -r .address)

# 2. Sign up in your app with $INBOX (browser agent, Playwright, etc.)

# 3. Block until the confirmation arrives, then take the code
curl -s "http://127.0.0.1:4100/api/inboxes/$INBOX/wait?timeout=30&subject=Confirm" \\
  | jq -r '.extract.codes[0]'
# => 482913`

const tools: [string, string][] = [
  [
    "create_inbox",
    "New email inbox or phone number. Address is generated if you don't pass one.",
  ],
  [
    "list_messages",
    "Messages in an inbox, newest first. Filter by direction, since, subject.",
  ],
  [
    "wait_for_message",
    "Blocks until a matching message arrives or the timeout passes.",
  ],
  ["extract", "One-time codes and links from a message, same as the UI shows."],
  [
    "send_to_app",
    "Email, text or fax your app from an inbox. Fires the inbound webhook.",
  ],
  [
    "list_webhooks",
    "Recent deliveries to your app with status codes, for checking handlers.",
  ],
  ["reset", "Clear every inbox, message and log."],
]

const rest: [string, string, string][] = [
  ["POST", "/api/inboxes", "Create an inbox"],
  ["GET", "/api/inboxes/:id/messages", "List messages"],
  ["GET", "/api/inboxes/:id/wait", "Long-poll for the next message"],
  ["GET", "/api/messages/:id", "One message, with raw source"],
  ["GET", "/api/messages/:id/extract", "Codes and links"],
  ["POST", "/api/inboxes/:id/send", "Send to the app (inbound)"],
  ["GET", "/api/webhooks", "Delivery log"],
  ["DELETE", "/api/inboxes/:id", "Remove an inbox"],
  ["POST", "/api/reset", "Wipe all state"],
]

export function AgentsPage() {
  return (
    <>
      <PageHeader
        title="Agent access"
        meta="Same inboxes, over MCP or plain HTTP"
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-4xl space-y-10 px-4 py-6 sm:px-6">
          <section className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
            <div className="space-y-2 text-xs leading-relaxed">
              <h2 className="text-[13px] font-medium">MCP server</h2>
              <p className="text-muted-foreground">
                Add this to your agent's MCP config. The server talks to the
                running emulator, so anything an agent does shows up here live,
                and anything you do here the agent can see.
              </p>
            </div>
            <Tabs defaultValue="claude" className="gap-0">
              <TabsList className="mb-2">
                <TabsTrigger
                  value="claude"
                  className="px-2.5 font-mono text-[11px]"
                >
                  .mcp.json
                </TabsTrigger>
                <TabsTrigger
                  value="cli"
                  className="px-2.5 font-mono text-[11px]"
                >
                  cli
                </TabsTrigger>
              </TabsList>
              <TabsContent value="claude">
                <CodeBlock code={mcpConfig} />
              </TabsContent>
              <TabsContent value="cli">
                <CodeBlock
                  code={`claude mcp add phonybox -- npx phonybox mcp --url http://127.0.0.1:4100`}
                  wrap
                />
              </TabsContent>
            </Tabs>
            <dl className="grid gap-x-8 border-t text-xs lg:col-span-2 lg:grid-cols-2">
              {tools.map(([name, desc]) => (
                <div
                  key={name}
                  className="grid grid-cols-[8.5rem_1fr] gap-3 border-b py-2"
                >
                  <dt>
                    <code className="text-[11.5px] font-medium">{name}</code>
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
