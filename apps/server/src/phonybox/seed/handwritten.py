"""The small demo seed: a handful of inboxes telling one realistic story
(signup codes, a bounced dunning email, an MMS whose webhook crashes the app,
a fax that hit a busy line). Mirrors apps/web/src/mocks/seed.ts."""

from __future__ import annotations

from datetime import datetime, timedelta
from email.utils import format_datetime
from typing import Any

from ..adapters.common import stable_hex, stable_uuid
from ..clock import iso
from ..text import format_address, sms_encoding
from . import OK, SeedData, SeedItem

ACME = {"name": "Acme", "address": "noreply@mg.acme.test"}
BILLING = {"name": "Acme Billing", "address": "billing@mg.acme.test"}
CRASH = '{\n  "error": "TypeError: Cannot read properties of undefined (reading \'url\')",\n  "at": "handleInboundMms (src/webhooks/telnyx.ts:48:31)"\n}'


def email_html(heading: str, paras: list[str], code: str | None = None, cta: tuple[str, str] | None = None) -> str:
    body = "".join(f'<p style="margin:12px 0">{p}</p>' for p in paras)
    code_html = (
        f'<tr><td style="padding:4px 32px 12px"><div style="font-family:ui-monospace,Menlo,monospace;font-size:28px;letter-spacing:0.18em;'
        f'background:#f4f4f2;border-radius:4px;padding:14px 0;text-align:center">{code}</div></td></tr>'
        if code else ""
    )
    cta_html = (
        f'<tr><td style="padding:8px 32px 20px"><a href="{cta[1]}" style="display:inline-block;background:#1c1b19;color:#fff;'
        f'text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:4px">{cta[0]}</a></td></tr>'
        if cta else ""
    )
    return (
        '<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1b19">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">'
        '<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e6e4df;border-radius:6px">'
        '<tr><td style="padding:28px 32px 8px"><div style="font-weight:700;font-size:15px">acme</div></td></tr>'
        f'<tr><td style="padding:8px 32px 4px"><h1 style="margin:0;font-size:20px;line-height:1.3">{heading}</h1></td></tr>'
        f'<tr><td style="padding:4px 32px 8px;font-size:14px;line-height:1.6">{body}</td></tr>{code_html}{cta_html}'
        '<tr><td style="padding:16px 32px 24px;border-top:1px solid #efeeea;font-size:12px;color:#77736b">'
        "Acme Inc. · 500 Howard St, San Francisco, CA<br/>You are receiving this because you have an Acme account.</td></tr>"
        "</table></td></tr></table></body></html>"
    )


def email_headers(item: dict[str, Any], at: datetime) -> list[tuple[str, str]]:
    out = [
        ("Received", f"from api (127.0.0.1) by phonybox mailgun; {format_datetime(at)}"),
        ("Message-Id", item["messageId"]),
        ("Date", format_datetime(at)),
        ("From", format_address(item["from"])),
        ("To", ", ".join(format_address(t) for t in item["to"])),
        ("Subject", item["subject"]),
        ("Mime-Version", "1.0"),
    ]
    if item["direction"] == "outbound" and item["tags"]:
        out.append(("X-Mailgun-Tag", ", ".join(item["tags"])))
    return out


def build(now: datetime) -> SeedData:
    def ago(minutes: float) -> datetime:
        return now - timedelta(minutes=minutes)

    def inbox(id: str, channel: str, address: str, label: str, adapter: str, minutes: float, pinned: bool = False, catch_all: bool = False) -> dict[str, Any]:
        return {
            "id": id, "channel": channel, "address": address, "label": label, "adapterId": adapter, "catchAll": catch_all,
            "tags": ["suite:manual"], "pinned": pinned, "createdBy": "seed", "createdAt": iso(ago(minutes)),
        }

    inboxes = [
        inbox("agent-1", "email", "agent-1@inbox.test", "Signup agent", "mailgun", 300, pinned=True),
        inbox("agent-2", "email", "agent-2@inbox.test", "Billing agent", "mailgun", 300, pinned=True),
        inbox("qa", "email", "qa@inbox.test", "Manual QA", "mailgun", 900),
        inbox("catch-all", "email", "*", "Catch-all", "mailgun", 900, catch_all=True),
        inbox("phone-1", "sms", "+14155550142", "Agent 1", "telnyx", 300, pinned=True),
        inbox("phone-2", "sms", "+14155550177", "Agent 2", "telnyx", 300),
        inbox("fax-records", "fax", "+12125550199", "Records desk", "telnyx", 900, pinned=True),
        inbox("fax-lab", "fax", "+13125550164", "Lab intake", "telnyx", 900),
    ]

    items: list[SeedItem] = []

    def mail(id: str, inbox_id: str, direction: str, sender: dict[str, str], to: str, subject: str, text: str, minutes: float,
             *, html: str | None = None, tags: list[str] | None = None, status: str = "delivered", read: bool = True,
             attachments: list[dict[str, Any]] | None = None, attempts: list[Any] | None = None, to_name: str | None = None) -> None:
        at = ago(minutes)
        item = {
            "id": id, "channel": "email", "inboxId": inbox_id, "adapterId": "mailgun", "direction": direction,
            "messageId": f"<{at:%Y%m%d%H%M%S}.{stable_hex(id, length=16)}@{'mg.acme.test' if direction == 'outbound' else 'inbox.test'}>",
            "from": sender, "to": [{"name": to_name, "address": to} if to_name else {"address": to}], "subject": subject, "text": text,
            "attachments": attachments or [], "headers": [], "tags": tags or [], "status": status, "read": read, "createdAt": iso(at),
        }
        heavy = {"headers": email_headers(item, at), **({"html": html} if html else {})}
        items.append(SeedItem(item, heavy, attempts or [OK]))

    mail("em-welcome", "agent-1", "outbound", ACME, "agent-1@inbox.test", "Welcome to Acme, Riley",
         "Your email is confirmed and your workspace is ready.\n\nNext step: invite the people you work with.\nhttp://localhost:3000/settings/members\n\n— The Acme team",
         1, to_name="Riley Chen", tags=["onboarding"], read=False,
         html=email_html("Welcome to Acme, Riley", ["Your email is confirmed and your workspace is ready.", "Next step: invite the people you work with."], cta=("Invite your team", "http://localhost:3000/settings/members")))
    mail("em-verify", "agent-1", "outbound", ACME, "agent-1@inbox.test", "Confirm your email address",
         "Enter this verification code to finish signing up:\n\n482 913\n\nOr open this link: http://localhost:3000/verify?token=evt_9f2c1b7e04d8a6\n\nThe code expires in 15 minutes.",
         6, tags=["verify-email"],
         html=email_html("Confirm your email address", ["Enter this verification code to finish signing up:"], code="482 913", cta=("Confirm email", "http://localhost:3000/verify?token=evt_9f2c1b7e04d8a6")))
    mail("em-payfail", "agent-2", "outbound", BILLING, "agent-2@inbox.test", "Payment failed for card ending 4242",
         "We couldn't charge your Visa ending 4242 for invoice INV-2041 ($249.00).\n\nUpdate your payment method: http://localhost:3000/billing/payment-method",
         9, tags=["billing", "dunning"], status="bounced", read=False,
         html=email_html("Payment failed", ["We couldn't charge your Visa ending 4242 for invoice <b>INV-2041</b> ($249.00)."], cta=("Update payment method", "http://localhost:3000/billing/payment-method")))
    mail("em-question", "agent-2", "inbound", {"name": "Billing Agent", "address": "agent-2@inbox.test"}, "billing@mg.acme.test", "Question about INV-2041",
         "Hi,\n\nInvoice INV-2041 lists 12 seats but we only have 9 active members. Can you check?\n\nThanks", 12,
         attempts=[(None, None, "ConnectError: connect ECONNREFUSED 127.0.0.1:3000"), (200, '{"ticket":"T-3318"}', None)])
    mail("em-invoice", "agent-2", "outbound", BILLING, "agent-2@inbox.test", "Your invoice INV-2041 is ready",
         "Invoice INV-2041 for $249.00 is attached.\n\nView online: http://localhost:3000/billing/invoices/INV-2041", 18,
         tags=["billing", "invoice"], attachments=[{"filename": "INV-2041.pdf", "contentType": "application/pdf", "size": 48213}],
         html=email_html("Invoice INV-2041", ["Your invoice for <b>$249.00</b> is attached."], cta=("View invoice", "http://localhost:3000/billing/invoices/INV-2041")))
    mail("em-invite", "catch-all", "outbound", ACME, "sam@contractor.dev", "Riley Chen invited you to the Northwind workspace",
         "Riley Chen (agent-1@inbox.test) invited you to join Northwind on Acme.\n\nAccept the invite: http://localhost:3000/invite/inv_3Kd82LmQ", 25,
         tags=["invite"], read=False,
         html=email_html("Join Northwind on Acme", ["Riley Chen invited you to join <b>Northwind</b>."], cta=("Accept invite", "http://localhost:3000/invite/inv_3Kd82LmQ")))
    mail("em-reply-reset", "qa", "inbound", {"name": "QA", "address": "qa@inbox.test"}, "support@mg.acme.test", "Re: Reset your password",
         "The reset link says it expired, but I clicked it about two minutes after it arrived.", 41, attempts=[(200, '{"ticket":"T-3301"}', None)])
    mail("em-reset", "qa", "outbound", ACME, "qa@inbox.test", "Reset your password",
         "Someone asked to reset the password for qa@inbox.test.\n\nReset it here: http://localhost:3000/reset?token=rst_51aa0c9e", 47, tags=["auth"],
         html=email_html("Reset your password", ["Someone asked to reset the password for qa@inbox.test."], cta=("Choose a new password", "http://localhost:3000/reset?token=rst_51aa0c9e")))
    mail("em-digest", "catch-all", "outbound", ACME, "jane.doe@example.com", "Your week in Northwind: 14 tasks closed",
         "14 tasks closed · 3 new members\n\nOpen your dashboard: http://localhost:3000/w/northwind", 190, tags=["digest"])

    def sms(id: str, inbox_id: str, peer: str, direction: str, app: str, body: str, minutes: float, *, read: bool = True,
            media: list[dict[str, Any]] | None = None, note: str | None = None, attempts: list[Any] | None = None) -> None:
        item: dict[str, Any] = {
            "id": id, "channel": "sms", "inboxId": inbox_id, "adapterId": "telnyx", "direction": direction, "providerId": stable_uuid("sms", id),
            "appNumber": app, "peerNumber": peer, "body": body, "media": media or [], "parts": sms_encoding(body)[1],
            "status": "delivered" if direction == "outbound" else "received", "read": read, "createdAt": iso(ago(minutes)),
        }
        if note:
            item["note"] = note
        items.append(SeedItem(item, None, attempts or [OK]))

    p1, p2, verify, alerts = "+14155550142", "+14155550177", "+16285550100", "+16285550111"
    sms("sm-1", "phone-1", p1, "outbound", verify, "Acme: your verification code is 731604. It expires in 10 minutes.", 34)
    sms("sm-2", "phone-1", p1, "outbound", verify, "Acme: your onboarding call is Thu Nov 13 at 2:30 PM PT. Reply C to confirm or R to reschedule.", 22)
    sms("sm-3", "phone-1", p1, "inbound", verify, "C", 21)
    sms("sm-4", "phone-1", p1, "outbound", verify, "Thanks, you're confirmed. We'll text you 30 minutes before the call.", 20.9)
    sms("sm-5", "phone-1", p1, "outbound", alerts, "Acme: order #10482 has shipped. Track it at http://localhost:3000/t/10482", 15)
    sms("sm-6", "phone-1", p1, "inbound", alerts, "STOP", 4)
    sms("sm-7", "phone-1", p1, "outbound", alerts, "You have successfully been unsubscribed. You will not receive any more messages from this number. Reply START to resubscribe.",
        3.9, read=False, note="Automatic opt-out reply. Sends from this number to this inbox now fail with 40300 until it texts START.")
    sms("sm-8", "phone-2", p2, "outbound", verify, "Acme support: sorry your order arrived damaged. Reply with a photo and we'll ship a replacement today.", 9)
    sms("sm-9", "phone-2", p2, "inbound", verify, "here you go, the corner is crushed", 7,
        media=[{"filename": "IMG_0412.jpg", "contentType": "image/jpeg", "size": 1248813}],
        attempts=[(500, CRASH, None), (500, CRASH, None), (500, CRASH, None)])

    def fax(id: str, inbox_id: str, peer: str, direction: str, title: str, pages: int, minutes: float, *, status: str, read: bool = True,
            failure: str | None = None, quality: str = "high") -> None:
        at = ago(minutes)
        if direction == "inbound":
            events = [{"event": "fax.received", "at": iso(at)}]
        else:
            last = "fax.failed" if status == "failed" else "fax.delivered"
            events = [{"event": e, "at": iso(at + timedelta(seconds=s))} for e, s in (("fax.queued", 0), ("fax.media.processed", 1), ("fax.sending.started", 2), (last, 40))]
        item: dict[str, Any] = {
            "id": id, "channel": "fax", "inboxId": inbox_id, "adapterId": "telnyx", "direction": direction, "providerId": stable_uuid("fax", id),
            "appNumber": "+16285550150", "peerNumber": peer, "title": title, "pages": pages, "quality": quality, "status": status,
            "events": events, "read": read, "createdAt": iso(at),
        }
        if failure:
            item["failureReason"] = failure
        items.append(SeedItem(item))

    fax("fx-priorauth", "fax-records", "+12125550199", "outbound", "Prior authorization request", 2, 8, status="failed", read=False, failure="user_busy")
    fax("fx-referral", "fax-records", "+12125550199", "outbound", "Patient referral, R. Okafor", 3, 27, status="delivered", read=False)
    fax("fx-consent", "fax-records", "+12125550199", "inbound", "Signed consent form", 2, 62, status="received")
    fax("fx-laborder", "fax-lab", "+13125550164", "outbound", "Lab order A-55821", 1, 124, status="delivered", quality="normal")

    return SeedData(inboxes, items)
