# Examples

End-to-end flows the way an agent test runs them: one inbox per run, your app sends, the agent waits and extracts, the human replies, the run cleans up. No dependencies beyond Python 3.11+ or Node 18+.

Start Phonybox first:

```sh
docker run --rm -p 4100-4102:4100-4102 ghcr.io/rohitlavu11/phonybox
```

| Script | Flow |
| --- | --- |
| [`python/email_signup.py`](python/email_signup.py) | Verification email through Mailgun → agent reads the code and link → user replies → your app gets a signed `route.forward` webhook |
| [`node/sms_2fa.mjs`](node/sms_2fa.mjs) | One-time code by SMS through Telnyx → agent reads it → user texts `STOP` → your app gets a signed `message.received` → the next text fails with `40300` |

```sh
python3 examples/python/email_signup.py
node examples/node/sms_2fa.mjs
```

```
1. inbox        +14155550100  (tag run:example-1d7a4b)
2. app sent     a code from +16285550100 via Telnyx
3. agent read   code 356912
4. user texted  STOP; Phonybox POSTs message.received to your app
   your app got  "STOP" from +14155550100, signature valid
5. app texted   again -> delivery_failed, error 40300 (Blocked due to STOP message)
6. cleaned up   inboxes tagged run:example-1d7a4b
```

Each script starts a tiny webhook receiver on `127.0.0.1:3000` to stand in for your app, and verifies signatures the way your production handler would. If port 3000 is taken (by your app, say), it skips the receiver and prints the delivery log instead. The Docker image already sends webhooks to `host.docker.internal:3000`; on Linux, add `--add-host=host.docker.internal:host-gateway` to `docker run`.

If you publish Phonybox on other ports, point the scripts at them with `PHONYBOX_URL`, `MAILGUN_URL` and `TELNYX_URL` (the last one ending in `/v2`). `WEBHOOK_PORT` moves the receiver.
