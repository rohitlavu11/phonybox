#!/usr/bin/env python3
"""Email signup, run the way an agent test would run it. Standard library only.

    python3 examples/python/email_signup.py

1. Creates an inbox for this run.
2. Plays your app: sends a verification email through the Mailgun API.
   (Plain HTTP here; your app would use its Mailgun SDK.)
3. Waits for the email and extracts the code and link, as an agent would.
4. Replies as the user. Phonybox POSTs a signed Mailgun route.forward webhook to
   your app; a small receiver on :3000 stands in for your app and checks the signature.
5. Deletes every inbox from this run.

Env: PHONYBOX_URL (default http://localhost:4100), MAILGUN_URL (default: same host,
Mailgun port from /api/health), WEBHOOK_PORT (default 3000).
If something already listens on WEBHOOK_PORT (your app, say), the receiver is skipped
and the script reads the webhook delivery log instead.
"""

from __future__ import annotations

import base64
import email
import email.policy
import hashlib
import hmac
import json
import os
import queue
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

PHONYBOX = os.environ.get("PHONYBOX_URL", "http://localhost:4100").rstrip("/")
API = f"{PHONYBOX}/api"
WEBHOOK_PORT = int(os.environ.get("WEBHOOK_PORT", "3000"))


def call(method: str, url: str, json_body: Any = None, *, form: dict[str, str] | None = None, auth: str | None = None, timeout: float = 10) -> Any:
    headers: dict[str, str] = {}
    data = None
    if json_body is not None:
        data, headers["content-type"] = json.dumps(json_body).encode(), "application/json"
    if form is not None:
        data, headers["content-type"] = urllib.parse.urlencode(form).encode(), "application/x-www-form-urlencoded"
    if auth:
        headers["authorization"] = "Basic " + base64.b64encode(auth.encode()).decode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
    except urllib.error.HTTPError as err:
        sys.exit(f"{method} {url} -> {err.code}: {err.read().decode()}")
    return json.loads(raw) if raw else None


# --- a stand-in for your app's webhook handlers ------------------------------------

webhooks: queue.Queue[tuple[str, str, bytes]] = queue.Queue()


class Receiver(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers.get("content-length", 0)))
        webhooks.put((self.path, self.headers.get("content-type", ""), body))
        self.send_response(200)
        self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:  # quiet
        pass


def start_receiver() -> ThreadingHTTPServer | None:
    try:
        server = ThreadingHTTPServer(("127.0.0.1", WEBHOOK_PORT), Receiver)
    except OSError:
        return None
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def form_fields(content_type: str, body: bytes) -> dict[str, str]:
    """multipart/form-data -> {name: value}, which is how Mailgun forwards mail."""
    msg = email.message_from_bytes(f"content-type: {content_type}\r\n\r\n".encode() + body, policy=email.policy.HTTP)
    return {part.get_param("name", header="content-disposition"): part.get_content() for part in msg.iter_parts()}  # type: ignore[attr-defined]


def mailgun_signature_ok(signing_key: str, timestamp: str, token: str, signature: str) -> bool:
    """Exactly the check from Mailgun's docs. Your production handler does the same."""
    expected = hmac.new(signing_key.encode(), (timestamp + token).encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# --- the test -------------------------------------------------------------------------


def main() -> None:
    health = call("GET", f"{API}/health")
    mailgun = os.environ.get("MAILGUN_URL") or f"http://{urllib.parse.urlsplit(PHONYBOX).hostname}:{health['ports']['mailgun']}"
    settings = call("GET", f"{API}/adapters")["mailgun"]["values"]
    domain, signing_key = settings["domain"], settings["signingKey"]
    run = f"example-{secrets.token_hex(3)}"
    receiver = start_receiver()

    # 1. An inbox of its own, so parallel runs never read each other's mail.
    inbox = call("POST", f"{API}/inboxes", {"channel": "email", "label": "email signup example", "tags": [f"run:{run}"]})
    address = inbox["address"]
    print(f"1. inbox        {address}  (tag run:{run})")

    # 2. Your app sends the verification email.
    code = f"{secrets.randbelow(10**6):06d}"
    sent = call(
        "POST",
        f"{mailgun}/v3/{domain}/messages",
        form={
            "from": f"Acme <noreply@{domain}>",
            "to": address,
            "subject": "Confirm your email",
            "text": f"Your code is {code}.\n\nOr confirm here: http://localhost:3000/verify?email={urllib.parse.quote(address)}",
        },
        auth="api:any-key-works",
    )
    print(f"2. app sent     'Confirm your email' via Mailgun: {sent['message']}")

    # 3. The agent waits for it and takes what it needs.
    got = call("GET", f"{API}/inboxes/{urllib.parse.quote(address)}/wait?subject=confirm&timeout=10", timeout=15)
    codes, links = got["extract"]["codes"], got["extract"]["links"]
    print(f"3. agent read   code {codes[0]}, link {links[0]}")
    assert codes == [code], f"expected {code}, got {codes}"

    # 4. The user replies. Your app receives Mailgun's inbound webhook.
    reply = call("POST", f"{API}/inboxes/{urllib.parse.quote(address)}/send", {"to": f"support@{domain}", "subject": "Re: Confirm your email", "text": "Done, thanks!"})
    print("4. user replied  Phonybox POSTs route.forward to your app")
    forward = None
    if receiver:
        try:
            while forward is None:
                path, content_type, body = webhooks.get(timeout=5)
                if path.endswith("/inbound"):
                    forward = form_fields(content_type, body)
        except queue.Empty:
            pass
    if forward:
        ok = mailgun_signature_ok(signing_key, forward["timestamp"], forward["token"], forward["signature"])
        print(f"   your app got  from {forward['sender']}, subject {forward['subject']!r}, signature {'valid' if ok else 'INVALID'}")
        assert ok
    else:
        # Someone else is on WEBHOOK_PORT (or Phonybox runs in Docker): read what happened instead.
        deadline = time.monotonic() + 15
        while not (deliveries := call("GET", f"{API}/items/{reply['id']}/webhooks")) and time.monotonic() < deadline:
            time.sleep(0.5)
        if deliveries:
            last = deliveries[-1]
            outcome = f"HTTP {last['status']}" if last["status"] else last["error"]
            print(f"   delivery log  {last['url']} -> {outcome}")
        else:
            print("   delivery log  no attempt yet; see Webhooks in the inspector")

    # 5. Clean up everything this run created.
    call("POST", f"{API}/inboxes/bulk", {"op": "delete", "query": {"q": f"tag:run:{run}"}, "except": []})
    print(f"5. cleaned up   inboxes tagged run:{run}")

    if receiver:
        receiver.shutdown()


if __name__ == "__main__":
    main()
