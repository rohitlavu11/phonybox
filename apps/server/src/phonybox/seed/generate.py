"""Load-test seed: thousands of inboxes shaped like agent test runs.
`random.Random(seed)` only, so the same seed always yields the same data."""

from __future__ import annotations

import random
from datetime import datetime, timedelta
from typing import Any

from ..adapters.common import stable_hex, stable_uuid
from ..clock import iso
from ..text import sms_encoding
from . import OK, Attempt, SeedData, SeedItem
from .handwritten import ACME, BILLING, email_headers, email_html

SIZES = {"email": 2400, "sms": 800, "fax": 300}
FIRST = ["Riley", "Sam", "Jordan", "Priya", "Mateo", "Aisha", "Wei", "Noah", "Elena", "Kofi", "Hana", "Lucas"]
LAST = ["Chen", "Okafor", "Garcia", "Patel", "Nguyen", "Kim", "Silva", "Novak", "Haddad", "Brown"]
WORKSPACES = ["Northwind", "Globex", "Initech", "Umbrella", "Hooli", "Vandelay"]
RUN_LABEL = {"signup": "Signup", "checkout": "Checkout", "billing": "Billing", "invite": "Invite", "reset": "Password reset", "onboarding": "Onboarding", "digest": "Digest", "support": "Support"}
INBOUND_SUBJECTS = {"billing": ["Question about my invoice", "Wrong seat count on invoice"], "reset": ["Re: Reset your password", "Reset link expired"], "support": ["Can't export to CSV", "Login loop on Safari"]}


def build(now: datetime, seed: int) -> SeedData:
    r = random.Random(seed)
    inboxes: list[dict[str, Any]] = []
    items: list[SeedItem] = []
    counter = 0

    def nid(prefix: str) -> str:
        nonlocal counter
        counter += 1
        return f"{prefix}-{counter:05x}"

    def ago(minutes: float) -> datetime:
        return now - timedelta(minutes=minutes)

    def attempts(fail_rate: float) -> list[Attempt]:
        if r.random() >= fail_rate:
            return [OK] if r.random() > 0.04 else [(503, '{"error":"Service Unavailable"}', None), OK]
        bad: Attempt = (None, None, "ConnectError: connect ECONNREFUSED 127.0.0.1:3000") if r.random() < 0.3 else (500, '{"error":"Internal Server Error"}', None)
        return [bad, bad, bad]

    def templates(suite: str) -> list[dict[str, Any]]:
        code = str(r.randint(100000, 999999))
        n = r.randint(1000, 99999)
        if suite == "signup":
            out = [{"subject": "Confirm your email address", "text": f"Enter this verification code to finish signing up:\n\n{code[:3]} {code[3:]}\n\nOr open http://localhost:3000/verify?token=evt_{stable_hex(code, length=12)}",
                    "html": email_html("Confirm your email address", ["Enter this verification code to finish signing up:"], code=f"{code[:3]} {code[3:]}"), "tags": ["verify-email"]}]
            if r.random() < 0.8:
                out.append({"subject": f"Welcome to Acme, {r.choice(FIRST)}", "text": "Your email is confirmed.\n\nInvite your team: http://localhost:3000/settings/members", "tags": ["onboarding"]})
            return out
        if suite == "checkout":
            out = [{"subject": f"Order #{n} confirmed", "text": f"Thanks for your order #{n}.\n\nView it: http://localhost:3000/orders/{n}", "tags": ["order"]}]
            if r.random() < 0.55:
                out.append({"subject": f"Order #{n} has shipped", "text": f"Track it: http://localhost:3000/t/{n}", "tags": ["shipping"]})
            return out
        if suite == "billing":
            inv = f"INV-{n % 9000 + 1000}"
            out = [{"subject": f"Your invoice {inv} is ready", "text": f"Invoice {inv} is attached.\n\nhttp://localhost:3000/billing/invoices/{inv}", "tags": ["billing", "invoice"],
                    "from": BILLING, "attachments": [{"filename": f"{inv}.pdf", "contentType": "application/pdf", "size": r.randint(30000, 90000)}]}]
            if r.random() < 0.3:
                out.append({"subject": "Payment failed for card ending 4242", "text": f"We couldn't charge your card for {inv}.\n\nhttp://localhost:3000/billing/payment-method",
                            "tags": ["billing", "dunning"], "from": BILLING, "bounce": r.random() < 0.5})
            return out
        if suite == "invite":
            return [{"subject": f"{r.choice(FIRST)} {r.choice(LAST)} invited you to {r.choice(WORKSPACES)}", "text": f"Accept the invite: http://localhost:3000/invite/inv_{stable_hex(code, length=8)}", "tags": ["invite"]}]
        if suite == "reset":
            return [{"subject": "Reset your password", "text": f"Reset it here: http://localhost:3000/reset?token=rst_{stable_hex(code, length=8)}", "tags": ["auth"]}]
        if suite == "onboarding":
            return [{"subject": "Finish setting up your workspace", "text": "Two steps left: http://localhost:3000/setup", "tags": ["onboarding"]}]
        if suite == "digest":
            return [{"subject": f"Your week in {r.choice(WORKSPACES)}: {r.randint(3, 40)} tasks closed", "text": "Open your dashboard: http://localhost:3000/w", "tags": ["digest"]}]
        return [{"subject": f"Re: Ticket T-{n % 7000 + 3000}", "text": "Thanks for the details. A fix is rolling out today.", "tags": ["support"]}]

    # ------------------------------------------------------------- email
    run = 4200
    suites = list(RUN_LABEL)
    counts = {"email": 0, "sms": 0, "fax": 0}
    while counts["email"] < SIZES["email"]:
        run -= 1
        suite = r.choice(suites)
        agents = r.randint(1, 5)
        age = 90 + (4200 - run) * r.randint(5, 12)
        for a in range(1, agents + 1):
            address = f"{suite}-{run}-{a}@inbox.test"
            inbox_id = f"{suite}-{run}-{a}"
            counts["email"] += 1
            inboxes.append({
                "id": inbox_id, "channel": "email", "address": address, "label": f"{RUN_LABEL[suite]} · run {run}" + (f" · #{a}" if agents > 1 else ""),
                "adapterId": "mailgun", "tags": [f"suite:{suite}", f"run:{run}"], "createdBy": "agent", "createdAt": iso(ago(age)),
            })
            t = age - 0.3
            for tpl in templates(suite):
                t -= r.random() * 2 + 0.2
                at = ago(t)
                iid = nid("gem")
                item = {
                    "id": iid, "channel": "email", "inboxId": inbox_id, "adapterId": "mailgun", "direction": "outbound",
                    "messageId": f"<{at:%Y%m%d%H%M%S}.{stable_hex(iid, length=16)}@mg.acme.test>", "from": tpl.get("from", ACME),
                    "to": [{"address": address}], "subject": tpl["subject"], "text": tpl["text"], "attachments": tpl.get("attachments", []),
                    "headers": [], "tags": tpl["tags"], "status": "bounced" if tpl.get("bounce") else "delivered",
                    "read": True if age > 400 else r.random() < 0.35, "createdAt": iso(at),
                }
                heavy = {"headers": email_headers(item, at), "html": tpl.get("html") or email_html(tpl["subject"], [tpl["text"].split("\n")[0]])}
                items.append(SeedItem(item, heavy, attempts(0.01)))
            if suite in INBOUND_SUBJECTS and r.random() < 0.35:
                t -= r.random() * 4 + 1
                at = ago(t)
                subject = r.choice(INBOUND_SUBJECTS[suite])
                item = {
                    "id": nid("gem"), "channel": "email", "inboxId": inbox_id, "adapterId": "mailgun", "direction": "inbound",
                    "messageId": f"<{stable_hex(address, subject, length=16)}@inbox.test>", "from": {"name": f"{RUN_LABEL[suite]} agent", "address": address},
                    "to": [{"address": "billing@mg.acme.test" if suite == "billing" else "support@mg.acme.test"}], "subject": subject,
                    "text": f"Hi,\n\n{subject}. Steps are in the log for run {run}.\n\nThanks", "attachments": [], "headers": [], "tags": [],
                    "status": "delivered", "read": True, "createdAt": iso(at),
                }
                items.append(SeedItem(item, {"headers": email_headers(item, at)}, attempts(0.06)))

    # --------------------------------------------------------------- sms
    areas = ["415", "628", "650", "408", "510", "707", "925", "212", "646", "718", "917", "312", "773", "206", "303", "512", "617", "702", "213", "310"]
    taken = {"+14155550142", "+14155550177"}
    labels = {"2fa": "2FA", "delivery": "Delivery", "appointments": "Appointments", "support": "Support", "promo": "Promo"}
    verify, alerts = "+16285550100", "+16285550111"
    i = 0
    while counts["sms"] < SIZES["sms"]:
        number = f"+1{areas[i % len(areas)]}55501{i // len(areas):02d}"
        i += 1
        if number in taken:
            continue
        suite = r.choice(list(labels))
        srun = r.randint(800, 1400)
        age = r.randint(100, 8000)
        inbox_id = f"n-{number[2:]}"
        counts["sms"] += 1
        inboxes.append({"id": inbox_id, "channel": "sms", "address": number, "label": f"{labels[suite]} · run {srun}", "adapterId": "telnyx",
                        "tags": [f"suite:{suite}", f"run:{srun}"], "createdBy": "agent", "createdAt": iso(ago(age))})
        t = age - 0.5

        def say(direction: str, app: str, body: str, note: str | None = None) -> None:
            nonlocal t
            t -= r.random() * 3 + 0.3
            iid = nid("gsm")
            item: dict[str, Any] = {
                "id": iid, "channel": "sms", "inboxId": inbox_id, "adapterId": "telnyx", "direction": direction, "providerId": stable_uuid("sms", iid),
                "appNumber": app, "peerNumber": number, "body": body, "media": [], "parts": sms_encoding(body)[1],
                "status": ("failed" if r.random() < 0.02 else "delivered") if direction == "outbound" else "received",
                "read": True if direction == "inbound" or age > 600 else r.random() < 0.4, "createdAt": iso(ago(t)),
            }
            if note:
                item["note"] = note
            items.append(SeedItem(item, None, attempts(0.01 if direction == "outbound" else 0.04)))

        if suite == "2fa":
            say("outbound", verify, f"Acme: your verification code is {r.randint(100000, 999999)}. It expires in 10 minutes.")
        elif suite == "delivery":
            say("outbound", alerts, f"Acme: order #{r.randint(10000, 99999)} has shipped. Track it at http://localhost:3000/t/{r.randint(10000, 99999)}")
            if r.random() < 0.25:
                say("inbound", alerts, "STOP")
                say("outbound", alerts, "You have successfully been unsubscribed. Reply START to resubscribe.", "Automatic opt-out reply.")
        elif suite == "appointments":
            say("outbound", verify, f"Acme: your call is {r.choice(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])} at {r.randint(1, 5)}:30 PM. Reply C to confirm or R to reschedule.")
            if r.random() < 0.7:
                reply = r.choice(["C", "R", "c", "Confirm"])
                say("inbound", verify, reply)
                say("outbound", verify, "Thanks, you're confirmed." if reply.lower().startswith("c") else "No problem. Pick a new time: http://localhost:3000/reschedule")
        elif suite == "support":
            say("outbound", verify, "Acme support: reply here with your order number and we'll take a look.")
            say("inbound", verify, f"#{r.randint(10000, 99999)}, it never arrived")
        else:
            say("outbound", alerts, f"Acme: {r.randint(10, 30)}% off annual plans this week. Reply STOP to opt out.")

    # --------------------------------------------------------------- fax
    fax_areas = ["212", "718", "312", "617", "415", "510", "206", "303", "404", "305", "214", "602"]
    depts = ["Records desk", "Lab intake", "Radiology", "Billing office", "Pharmacy", "Referrals", "Cardiology", "Admissions"]
    cities = ["Oakland", "Brooklyn", "Evanston", "Cambridge", "Daly City", "Tacoma", "Boulder", "Decatur", "Miami", "Plano"]
    fax_taken = {"+12125550199", "+13125550164"}
    i = 0
    while counts["fax"] < SIZES["fax"]:
        number = f"+1{fax_areas[i % len(fax_areas)]}55501{i // len(fax_areas):02d}"
        i += 1
        if number in fax_taken:
            continue
        age = r.randint(200, 9000)
        inbox_id = f"f-{number[2:]}"
        counts["fax"] += 1
        inboxes.append({"id": inbox_id, "channel": "fax", "address": number, "label": f"{r.choice(depts)} · {r.choice(cities)}", "adapterId": "telnyx",
                        "tags": ["suite:fax"], "createdBy": "seed", "createdAt": iso(ago(age))})
        t = age - 1
        for _ in range(r.randint(0, 4)):
            t -= r.random() * 30 + 1
            inbound = r.random() < 0.2
            failed = not inbound and r.random() < 0.06
            at = ago(t)
            title = r.choice(["Signed consent form", "Completed intake form"]) if inbound else r.choice(
                [f"Patient referral, {r.choice(FIRST)[0]}. {r.choice(LAST)}", f"Lab order A-{r.randint(10000, 99999)}", "Prior authorization request", "Discharge summary"]
            )
            iid = nid("gfx")
            events = [{"event": "fax.received", "at": iso(at)}] if inbound else [
                {"event": e, "at": iso(at + timedelta(seconds=s))}
                for e, s in (("fax.queued", 0), ("fax.media.processed", 1), ("fax.sending.started", 2), ("fax.failed" if failed else "fax.delivered", 40))
            ]
            item: dict[str, Any] = {
                "id": iid, "channel": "fax", "inboxId": inbox_id, "adapterId": "telnyx", "direction": "inbound" if inbound else "outbound",
                "providerId": stable_uuid("fax", iid), "appNumber": "+16285550150", "peerNumber": number, "title": title, "pages": r.randint(1, 6),
                "quality": r.choice(["normal", "high", "high", "very_high"]), "status": "received" if inbound else "failed" if failed else "delivered",
                "events": events, "read": True if age > 600 or inbound else r.random() < 0.4, "createdAt": iso(at),
            }
            if failed:
                item["failureReason"] = r.choice(["user_busy", "receiver_no_answer"])
            items.append(SeedItem(item, None, attempts(0.02)))

    return SeedData(inboxes, items)
