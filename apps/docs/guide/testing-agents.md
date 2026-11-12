# Testing AI agents

Phonybox is built for agents that act through email, SMS and fax: a support agent that texts customers, a browser agent that signs up and needs the verification code, a back-office agent that faxes referrals. The pattern is the same every time.

## The loop

1. **Give the run its own inbox.** Parallel runs never read each other's mail.
2. **Let the agent act.** It uses your app, which talks to Phonybox through its normal SDK.
3. **Wait for the message and take what you need.** Codes and links are extracted for you.
4. **Reply as the human**, if the flow needs it. Your app gets a real inbound webhook.
5. **Clean up by tag.**

```sh
API=http://localhost:4100/api

# 1. a fresh inbox (address generated if you don't pass one)
INBOX=$(curl -s -X POST $API/inboxes -H 'content-type: application/json' \
  -d '{"channel":"email","label":"signup run 42","tags":["suite:signup","run:42"]}' | jq -r .address)

# 2. ...the agent signs up in your app with $INBOX...

# 3. block until the confirmation arrives (up to 30s), take the code
curl -s "$API/inboxes/$INBOX/wait?subject=confirm&timeout=30" | jq -r '.extract.codes[0]'

# 4. reply as the user; your app receives a Mailgun route.forward webhook
curl -s -X POST "$API/inboxes/$INBOX/send" -H 'content-type: application/json' \
  -d '{"to":"support@mg.acme.test","subject":"Re: Confirm","text":"Done, thanks"}'

# 5. delete every inbox from this run
curl -s -X POST $API/inboxes/bulk -H 'content-type: application/json' \
  -d '{"op":"delete","query":{"q":"tag:run:42"},"except":[]}'
```

SMS works the same way: create `{"channel":"sms"}` to get a free `555-01xx` number, then wait on it. `/send` takes `{"appNumber":"+16285550100","body":"STOP"}`.

## In a test framework

::: code-group

```python [pytest]
import httpx, pytest

API = "http://localhost:4100/api"

@pytest.fixture
def inbox(request):
    run = request.node.name
    box = httpx.post(f"{API}/inboxes", json={"channel": "email", "tags": [f"run:{run}"]}).json()
    yield box["address"]
    httpx.post(f"{API}/inboxes/bulk", json={"op": "delete", "query": {"q": f"tag:run:{run}"}, "except": []})

def test_signup_sends_a_code(inbox, agent):
    agent.run(f"Sign up for Acme with {inbox} and confirm the account")
    got = httpx.get(f"{API}/inboxes/{inbox}/wait", params={"subject": "confirm", "timeout": 30}, timeout=35).json()
    assert got["extract"]["codes"], got["item"]["text"]
```

```ts [Node]
const API = "http://localhost:4100/api"

const { address } = await fetch(`${API}/inboxes`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ channel: "sms", tags: ["run:42"] }),
}).then((r) => r.json())

await agent.run(`Enroll the phone number ${address} in two-factor auth`)

const { extract } = await fetch(`${API}/inboxes/${encodeURIComponent(address)}/wait?timeout=30`).then((r) => r.json())
expect(extract.codes[0]).toMatch(/^\d{6}$/)
```

:::

## Endpoints agents use most

| Call | What it does |
| --- | --- |
| `POST /api/inboxes` | Create one inbox (`{channel, address?, label?, tags?}`) or many (send an array). |
| `GET /api/inboxes/{idOrAddress}/wait` | Long-poll until a matching item exists. `subject`, `direction` (default `outbound`), `since`, `timeout` (s). Returns `{item, extract}`; `408` on timeout. |
| `GET /api/inboxes/{idOrAddress}/messages` | Everything in the inbox, newest first, paged. |
| `GET /api/items/{id}/extract` | One-time codes and links from a message. |
| `POST /api/inboxes/{idOrAddress}/send` | Send from the inbox to your app, as the provider's inbound webhook. |
| `POST /api/inboxes/bulk` | `delete`, `clear`, `read`, `pin`, `unpin` by ids, or by query minus exceptions. |
| `GET /api/webhooks?failed=true` | Deliveries your app rejected, to assert your handlers held up. |
| `POST /api/reset` | Back to a seed (`empty`, `small`, `large`). |

Full reference: [Control API](/reference/control-api), or the live OpenAPI docs at `http://localhost:4100/api/docs`.

## Testing the hard parts

These are the cases real providers make difficult to test:

- **Opt-outs.** Send `STOP` from an inbox. Later sends from that app number fail with `40300` in `message.finalized`, until the inbox sends `START`.
- **Bounces.** Mail to `bounce@…` or `…+bounce@…` is stored as bounced, and your app gets `permanent_fail`.
- **Busy fax lines and undeliverable texts.** Add a number to Telnyx `failNumbers` and faxes to it end in `fax.failed` (`user_busy`), texts in `delivery_failed`.
- **Your own handler failing.** Make your webhook route return 500 and watch Phonybox retry it. Fix the handler, then hit **Replay**.
- **MMS.** Inbound MMS carries media URLs your app can fetch from Phonybox.

## Tips

- Use `tags` such as `run:<id>` and `suite:<name>`; search accepts `tag:run:42` (prefix match).
- Prefer a fresh inbox per run over `since=`; it removes timing races.
- Unknown recipients get an inbox created automatically (`createdBy: "auto"`). Start with `--no-auto-inboxes` to route unknown email to the catch-all instead.
- An MCP server for agents is on the [roadmap](/roadmap).
