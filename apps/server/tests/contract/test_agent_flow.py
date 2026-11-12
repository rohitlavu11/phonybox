"""The workflow the product exists for: an agent tests a signup flow end to end."""

from __future__ import annotations

import httpx

from phonybox.emulator import Emulator
from tests.support.contracts import form_fields
from tests.support.fakes import DOMAIN, FakeApp


async def test_email_verification_then_reply(emu: Emulator, control: httpx.AsyncClient, mailgun: httpx.AsyncClient, fake_app: FakeApp) -> None:
    # 1. The agent gets a fresh inbox for this run.
    inbox = (await control.post("/api/inboxes", json={"channel": "email", "label": "signup run 42", "tags": ["suite:signup", "run:42"]})).json()
    address = inbox["address"]

    # 2. The app under test sends the verification email through its Mailgun SDK.
    await mailgun.post(f"/v3/{DOMAIN}/messages", data={
        "from": "Acme <noreply@mg.acme.test>", "to": address, "subject": "Confirm your email address",
        "text": "Your verification code is 482 913.\nOr open http://localhost:3000/verify?token=evt_abc",
    })

    # 3. The agent waits for it and takes the code and link.
    got = (await control.get(f"/api/inboxes/{address}/wait", params={"subject": "confirm", "timeout": 0})).json()
    assert got["extract"] == {"codes": ["482913"], "links": ["http://localhost:3000/verify?token=evt_abc"]}

    # 4. The agent replies; the app receives it as a Mailgun route forward.
    await control.post(f"/api/inboxes/{inbox['id']}/send", json={"to": "support@mg.acme.test", "subject": "Re: Confirm", "text": "Done, thanks"})
    await emu.run_until_idle()
    forward = form_fields(fake_app.to("/webhooks/mailgun/inbound")[0])
    assert (forward["sender"], forward["stripped-text"]) == (address, "Done, thanks")

    # 5. Cleanup by tag, the way a test runner would after the run.
    r = await control.post("/api/inboxes/bulk", json={"op": "delete", "query": {"q": "tag:run:42"}, "except": []})
    assert r.json() == {"affected": 1}


async def test_sms_two_factor(emu: Emulator, control: httpx.AsyncClient, telnyx: httpx.AsyncClient) -> None:
    number = (await control.post("/api/inboxes", json={"channel": "sms"})).json()["address"]
    await telnyx.post("/v2/messages", json={"from": "+16285550100", "to": number, "text": "Acme: your code is 551 204"})
    got = (await control.get(f"/api/inboxes/{number}/wait", params={"timeout": 0})).json()
    assert got["item"]["channel"] == "sms" and got["extract"]["codes"] == ["551204"]
