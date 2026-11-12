# The inspector

The web UI on port `4100` shows everything Phonybox has seen. It's built for thousands of inboxes: lists are paged on the server and virtualized in the browser, and it updates live over server-sent events.

## Mail

<Shot name="mail" alt="Mail view with a verification email open and its code extracted" dark />

Three panes: every inbox on the channel (search, filter by unread, pinned or failing, sort), the messages in the selected inbox, and the message itself, with Preview, Text, HTML, Headers, Raw and Webhooks tabs. Codes and links are pulled out above the body. **Send to app** and **Reply** deliver mail to your app through the Mailgun adapter's inbound route.

## SMS

<Shot name="sms" alt="An SMS thread with a failed inbound MMS webhook" dark />

Threads are shown from the phone's side: what your app sent is on the left. Inbound bubbles show whether your app accepted the webhook. Keyword buttons send `STOP`, `START`, `HELP` and friends.

## Fax

<Shot name="fax" alt="A three-page fax with its lifecycle events" />

Pages are rendered, and the status timeline follows the Telnyx events (`fax.queued` → `fax.media.processed` → `fax.sending.started` → `fax.delivered`).

## Inboxes

<Shot name="inboxes" alt="The inbox directory with thousands of agent inboxes" dark />

All inboxes across channels, for the jobs that don't fit one channel: auditing what agents created and cleaning up in bulk. **Select all N matching** acts on the whole filtered set, not just what's loaded.

## Webhooks and API log

<Shot name="webhooks" alt="A webhook delivery with its signed request" />

Every request Phonybox made to your app (each attempt, status, headers, body and response), and every request your app made to Phonybox.

## Adapters and agent access

<Shot name="adapter" alt="Telnyx adapter settings" />

Each adapter page has connection snippets, the emulated endpoints, webhook URLs, keys and fault rules. **Agent access** documents the HTTP API agents use.

## Keyboard

`⌘K` command menu, `j` / `k` to move, `/` to search, `c` to compose, `r` to reply, `d` to toggle dark mode.
