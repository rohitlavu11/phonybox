# Connect your app

Phonybox speaks each provider's real HTTP API, so your app keeps its SDK and only changes the base URL. Any API key is accepted unless you turn that off on the adapter's **Keys** tab.

## Mailgun

::: code-group

```ts [mailgun.js]
import formData from "form-data"
import Mailgun from "mailgun.js"

const mg = new Mailgun(formData).client({
  username: "api",
  key: process.env.MAILGUN_API_KEY!,
  url: process.env.MAILGUN_URL, // http://localhost:4101 in tests, unset in production
})

await mg.messages.create("mg.acme.test", {
  from: "Acme <noreply@mg.acme.test>",
  to: ["agent-1@inbox.test"],
  subject: "Confirm your email",
  text: "Your code is 482913",
})
```

```python [Python (mailgun)]
from mailgun.client import Client

client = Client(auth=("api", os.environ["MAILGUN_API_KEY"]), api_url=os.environ.get("MAILGUN_URL"))
client.messages.create(domain="mg.acme.test", data={
    "from": "Acme <noreply@mg.acme.test>",
    "to": "agent-1@inbox.test",
    "subject": "Confirm your email",
    "text": "Your code is 482913",
})
```

:::

The default sending domain is `mg.acme.test`; change it on **Adapters → Mailgun**. Sends to any other domain return Mailgun's `404 Domain not found`.

## Telnyx

::: code-group

```ts [telnyx (Node)]
import Telnyx from "telnyx"

const telnyx = new Telnyx({
  apiKey: process.env.TELNYX_API_KEY,
  baseURL: process.env.TELNYX_BASE_URL, // http://localhost:4102/v2
})

await telnyx.messages.send({ from: "+16285550100", to: "+14155550142", text: "Your code is 731604" })
```

```python [telnyx (Python)]
from telnyx import Telnyx

client = Telnyx(api_key=os.environ["TELNYX_API_KEY"], base_url=os.environ.get("TELNYX_BASE_URL"))
client.messages.send(from_="+16285550100", to="+14155550142", text="Your code is 731604")
client.faxes.create(connection_id="my-fax-app", from_="+16285550150", to="+12125550199",
                    media_url="https://example.com/referral.pdf")
```

:::

Your app's own numbers default to `+16285550100`, `+16285550111` and `+16285550150`. Sends from other numbers fail with Telnyx error `40305`, like an unowned number would.

## Receiving webhooks

Phonybox POSTs webhooks to your app at `http://localhost:3000/webhooks/...` by default:

| Adapter | Setting | Default path |
| --- | --- | --- |
| Mailgun | Inbound route URL | `/webhooks/mailgun/inbound` |
| Mailgun | Event webhook URL | `/webhooks/mailgun/events` |
| Telnyx | Messaging webhook URL | `/webhooks/telnyx/messaging` |
| Telnyx | Fax webhook URL | `/webhooks/telnyx/fax` |

Change them per adapter in the UI, or move them all at once with `--webhook-base` (`PHONYBOX_WEBHOOK_BASE`). In Docker, that's usually `http://host.docker.internal:3000`.

Failed deliveries (non-2xx or connection errors) are retried after 2s and 10s, and every attempt shows up on the **Webhooks** page, where you can replay one or copy it as cURL.

## Verifying signatures

Keep your production verification code; it works against Phonybox.

::: code-group

```ts [Mailgun (HMAC)]
import crypto from "node:crypto"

function verifyMailgun(signingKey: string, { timestamp, token, signature }: Record<string, string>) {
  const digest = crypto.createHmac("sha256", signingKey).update(timestamp + token).digest("hex")
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
}
// signing key: MAILGUN_WEBHOOK_SIGNING_KEY=whsk-local-mg-3f9a21 (Adapters → Mailgun → Keys)
```

```python [Telnyx (Ed25519)]
from telnyx import Telnyx

client = Telnyx(api_key="...", public_key=os.environ["TELNYX_PUBLIC_KEY"])
event = client.webhooks.unwrap(raw_body, headers=request.headers)  # raises on a bad signature
```

:::

Telnyx's public key is printed when Phonybox starts and shown under **Adapters → Telnyx → Keys**. It's derived from a fixed seed, so it stays the same across restarts and you can keep it in `.env.test`.
