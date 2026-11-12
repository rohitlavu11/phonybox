# Use with Claude (MCP)

Every Phonybox serves an [MCP](https://modelcontextprotocol.io) server at `/mcp`. Connect Claude Code, or any MCP client, and the agent gets tools to test your product's email, SMS and fax flows: create an inbox, use it in your product, read the code or link your app sends, reply as the person, and check that your webhook handlers held up.

## Connect

Start Phonybox ([Getting started](./getting-started)), then:

::: code-group

```sh [Claude Code]
claude mcp add --transport http phonybox http://localhost:4100/mcp
# add --scope project to share it with your team through .mcp.json
```

```json [.mcp.json]
{
  "mcpServers": {
    "phonybox": { "type": "http", "url": "http://localhost:4100/mcp" }
  }
}
```

```json [stdio (Claude Desktop)]
{
  "mcpServers": {
    "phonybox": {
      "command": "uvx",
      "args": [
        "--from", "git+https://github.com/rohitlavu11/phonybox#subdirectory=apps/server",
        "phonybox", "mcp", "--url", "http://localhost:4100"
      ]
    }
  }
}
```

:::

The HTTP endpoint needs nothing installed beyond Phonybox itself, including the Docker image. Use stdio for clients that can only launch a command; `phonybox mcp` runs the same tools against the Phonybox at `--url`. The inspector's **Agent access** page shows these snippets with your server's actual address.

Check it's connected with `claude mcp list`, or `/mcp` inside Claude Code.

## Ask Claude to test something

Point your app at Phonybox ([Connect your app](./connect-your-app)), then ask in plain words. For example:

> Test the sign-up flow at http://localhost:3000. Create a fresh email inbox tagged run:signup, sign up with it, open the confirmation link from the email, and check the account is verified. Then reply to the email and confirm my webhook handler accepted it. Clean up the inbox at the end, and give me a pass/fail table.

Claude calls `get_setup` to see how things are wired, `create_inbox`, drives your product (through a browser tool, `curl`, or your test runner), then `wait_for_message`, `send_email_to_app`, `list_webhook_deliveries` and `delete_inboxes`. Everything it does shows up in the inspector as it happens.

## Tools

| Tool | What it does |
| --- | --- |
| `get_setup` | Each provider's API base URL, how to point its SDK there, credentials, and the webhook URLs Phonybox calls on your app. |
| `configure_provider` | Change a provider's settings: point webhooks at your app's port, set `failNumbers` to make deliveries fail on purpose. |
| `create_inbox` | A fresh email address or phone number for a test run, with tags for cleanup. |
| `list_inboxes` | Inboxes, most recently active first. Your app's first message to a new address creates one. |
| `wait_for_message` | Waits for the email, text or fax your app sends. Returns its codes, and its links with their link text, so "Confirm email" isn't confused with "Unsubscribe". |
| `list_messages`, `read_message` | An inbox's messages, and one in full. |
| `send_email_to_app` | Email your app as the person. `reply_to_message_id` replies to a message (to its Reply-To or sender, with "Re: …"). |
| `send_sms_to_app` | Text your app as the person. Replies to the number that last texted them. `STOP` and `START` change opt-out state. |
| `send_fax_to_app` | Fax your app. |
| `list_webhook_deliveries` | Every delivery to your app (inbound messages, receipts, fax events) with your app's status code. |
| `get_webhook_delivery` | One delivery in full: the exact signed request and your app's response. |
| `replay_webhook` | Re-send a delivery, byte for byte, after fixing a handler. |
| `list_api_requests` | What your app sent to the provider APIs, and the error body when Phonybox rejected it. |
| `delete_inboxes` | Delete every inbox with a tag, or one inbox. |

The send tools wait briefly for your app's webhook response and include it in the result, so Claude sees straight away when a handler returns 500 or isn't listening.

## When something doesn't arrive

If `wait_for_message` times out, its error says what Phonybox saw: whether an inbox exists for that address, what's in it, and the last provider API calls your app made with their status codes. "Phonybox hasn't received any API calls from the app" usually means the app's SDK still points at the real provider; `get_setup` shows the URLs it should use.

## Tips

- Give each run its own inbox and tag (`run:<name>`), and delete by tag at the end. Parallel runs never see each other's messages.
- To wait for a second message in the same inbox (say, a resent code), pass the first message's id as `after_message_id`.
- If your app listens on a port other than 3000, ask Claude to point the webhooks there; it uses `configure_provider`.
- Phonybox in Docker sends webhooks to `host.docker.internal:3000` by default, which reaches your machine.

## Security

The MCP endpoint has the same access as the control API: anyone who can reach it can read and send messages. Keep Phonybox on your machine or inside CI. Requests from web pages on other sites (anything with an `Origin` header that isn't localhost) are refused, which also blocks DNS-rebinding attacks.
