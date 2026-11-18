# Security

## Phonybox is a test tool

Phonybox is meant to run on your machine or inside CI. By design it:

- accepts any API key unless you turn key checking on,
- has no user accounts; the inspector, control API and MCP endpoint are open unless you set `PHONYBOX_ACCESS_TOKEN`, one shared token,
- stores everything it receives in plain text,
- will POST webhooks to whatever URL its settings name.

So:

- **Don't expose it to the internet** or an untrusted network without an access token, your own keys and your own Telnyx key seed ([In the cloud](https://rohitlavu11.github.io/phonybox/guide/docker#in-the-cloud)). The Docker image binds to `0.0.0.0` inside the container; publish its ports to `127.0.0.1` (`-p 127.0.0.1:4100-4102:4100-4102`) if other people share your network.
- **Don't send real customer data through it.** Use test addresses and the fictional `555-01xx` numbers.
- **Don't reuse production credentials** in apps pointed at Phonybox. The signing keys it ships with are public.

## Reporting a vulnerability

If you find a vulnerability that matters even with those caveats (for example, code execution from a crafted message, or the server reaching hosts it shouldn't when run as documented), report it privately: use **Report a vulnerability** on the repository's [Security tab](https://github.com/rohitlavu11/phonybox/security/advisories/new). Please don't open a public issue.

You'll get a reply within a week. Fixes go into the latest release; there are no backports while the project is pre-1.0.
