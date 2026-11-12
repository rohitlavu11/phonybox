"""The MCP tools agents use to test an app: deterministic, in-process, frozen clock.

The server is the one mounted on the control app at /mcp; the client connects to it
in memory. Webhooks reach FakeApp; tests drive delivery with emu.settle().
"""

from __future__ import annotations

from typing import Any

import httpx
from mcp import Client

from phonybox.emulator import Emulator
from phonybox.mcp_server import links
from tests.support.fakes import DOMAIN, FakeApp

HOOK = "/webhooks/telnyx/messaging"
ROUTE = "/webhooks/mailgun/inbound"
APP = "+16285550100"
OTHER_APP = "+16285550111"
PHONE = "+14155550142"

TOOLS = {
    "get_setup", "configure_provider", "create_inbox", "list_inboxes", "delete_inboxes", "wait_for_message",
    "list_messages", "read_message", "send_email_to_app", "send_sms_to_app", "send_fax_to_app",
    "list_webhook_deliveries", "get_webhook_delivery", "replay_webhook", "list_api_requests",
}


def connect(emu: Emulator) -> Client:
    """In-memory client for the server mounted at /mcp. Opened inside each test: anyio task groups
    must be entered and exited in the same task, and pytest-asyncio splits fixtures across tasks."""
    return Client(emu.control.state.mcp)


async def call(client: Client, tool: str, **args: Any) -> Any:
    result = await client.call_tool(tool, args)
    assert not result.is_error, result.content[0].text  # type: ignore[union-attr]
    return result.structured_content


async def fail(client: Client, tool: str, **args: Any) -> str:
    result = await client.call_tool(tool, args)
    assert result.is_error, result.structured_content
    return result.content[0].text  # type: ignore[union-attr]


async def test_every_tool_is_described_and_annotated(emu: Emulator) -> None:
    async with connect(emu) as mcp:
        tools = {t.name: t for t in (await mcp.list_tools()).tools}
        assert set(tools) == TOOLS
        assert all(t.description and len(t.description) > 40 for t in tools.values())
        reads = {"get_setup", "list_inboxes", "wait_for_message", "list_messages", "read_message", "list_webhook_deliveries", "get_webhook_delivery", "list_api_requests"}
        assert {name for name, t in tools.items() if t.annotations and t.annotations.read_only_hint} == reads
        assert {name for name, t in tools.items() if t.annotations and t.annotations.destructive_hint} == {"delete_inboxes"}


async def test_setup_tells_an_agent_how_to_point_the_app_here(emu: Emulator) -> None:
    async with connect(emu) as mcp:
        setup = await call(mcp, "get_setup")
        assert setup["inspector"] == "http://127.0.0.1:4100"
        providers = {p["id"]: p for p in setup["providers"]}
        assert providers["mailgun"]["api_base_url"] == "http://127.0.0.1:4101"
        assert providers["telnyx"]["api_base_url"] == "http://127.0.0.1:4102/v2"
        assert "baseURL: 'http://127.0.0.1:4102/v2'" in providers["telnyx"]["sdk_setup"]
        assert providers["telnyx"]["channels"] == ["sms", "fax"]
        assert providers["telnyx"]["settings"]["messagingUrl"] == "http://localhost:3000/webhooks/telnyx/messaging"
        assert providers["mailgun"]["settings"]["domain"] == DOMAIN


async def test_email_signup_flow(mailgun: httpx.AsyncClient, emu: Emulator, fake_app: FakeApp) -> None:
    async with connect(emu) as mcp:
        box = await call(mcp, "create_inbox", channel="email", tags=["run:1"], label="signup")
        assert box["address"].endswith("@inbox.test") and box["tags"] == ["run:1"]

        # The app sends an HTML-only email: the link is in an href, with &amp; in it.
        html = (
            '<p>Welcome!</p><p><a href="http://localhost:3000/confirm?t=abc&amp;u=1">Confirm email</a></p>'
            '<p>Your code is 482913</p><p><a href="http://localhost:3000/unsubscribe">Unsubscribe</a></p>'
        )
        r = await mailgun.post(
            f"/v3/{DOMAIN}/messages",
            data={"from": f"Acme <noreply@{DOMAIN}>", "to": box["address"], "subject": "Confirm your email", "html": html, "h:Reply-To": f"help@{DOMAIN}"},
        )
        assert r.status_code == 200

        got = await call(mcp, "wait_for_message", inbox=box["address"], timeout_seconds=1, contains="CONFIRM")
        assert (got["direction"], got["from"], got["subject"]) == ("from_app", f"Acme <noreply@{DOMAIN}>", "Confirm your email")
        assert got["codes"] == ["482913"]
        assert got["links"] == [
            {"url": "http://localhost:3000/confirm?t=abc&u=1", "text": "Confirm email"},
            {"url": "http://localhost:3000/unsubscribe", "text": "Unsubscribe"},
        ]
        assert await call(mcp, "read_message", message_id=got["id"]) == got

        # Reply as the person: goes to Reply-To, subject "Re: …", and reaches the app as a route forward.
        sent = await call(mcp, "send_email_to_app", inbox=box["address"], text="Done, thanks", reply_to_message_id=got["id"], wait_for_delivery_seconds=0)
        assert sent["message"]["to"] == [f"help@{DOMAIN}"] and sent["message"]["subject"] == "Re: Confirm your email"
        assert sent["message"]["direction"] == "to_app"
        assert sent["webhook"] is None and "No webhook attempt within 0s" in sent["hint"]
        await emu.settle()
        [forward] = fake_app.to(ROUTE)
        assert b"Re: Confirm your email" in forward.content
        [attempt] = (await call(mcp, "list_webhook_deliveries", message_id=sent["message"]["id"]))["deliveries"]
        assert (attempt["event"], attempt["ok"], attempt["status"], attempt["attempt"]) == ("route.forward", True, 200, "1 of 3")

        listing = await call(mcp, "list_messages", inbox=box["address"])
        assert listing["total"] == 2 and [m["direction"] for m in listing["messages"]] == ["to_app", "from_app"]
        assert (await call(mcp, "delete_inboxes", tag="run:1")) == {"deleted": 1}


async def test_waiting_for_the_next_message_and_explaining_a_timeout(telnyx: httpx.AsyncClient, emu: Emulator) -> None:
    async with connect(emu) as mcp:
        await telnyx.post("/v2/messages", json={"from": APP, "to": PHONE, "text": "Your Acme code is 111111"})
        first = await call(mcp, "wait_for_message", inbox=PHONE, timeout_seconds=1)
        assert (first["from"], first["to"], first["codes"]) == (APP, PHONE, ["111111"])

        await emu.advance(1)
        await telnyx.post("/v2/messages", json={"from": APP, "to": PHONE, "text": "Your new Acme code is 222222"})
        second = await call(mcp, "wait_for_message", inbox=PHONE, timeout_seconds=1, after_message_id=first["id"])
        assert second["codes"] == ["222222"]

        err = await fail(mcp, "wait_for_message", inbox=PHONE, timeout_seconds=0, after_message_id=second["id"])
        assert f"Nothing from the app arrived in {PHONE} within 0s." in err
        assert "The inbox has 2 message(s)" in err
        assert "POST /v2/messages -> 200" in err


async def test_a_missing_inbox_explains_what_phonybox_saw(emu: Emulator) -> None:
    async with connect(emu) as mcp:
        err = await fail(mcp, "wait_for_message", inbox="nobody@inbox.test", timeout_seconds=0)
        assert "No inbox exists for that address yet" in err
        assert "hasn't received any API calls from the app" in err


async def test_texting_back_replies_to_the_number_that_texted(telnyx: httpx.AsyncClient, emu: Emulator, fake_app: FakeApp) -> None:
    async with connect(emu) as mcp:
        await telnyx.post("/v2/messages", json={"from": OTHER_APP, "to": PHONE, "text": "Reply YES to confirm your appointment"})
        fake_app.respond(HOOK, 500)
        sent = await call(mcp, "send_sms_to_app", inbox=PHONE, text="YES", wait_for_delivery_seconds=0)
        assert (sent["message"]["from"], sent["message"]["to"], sent["message"]["direction"]) == (PHONE, OTHER_APP, "to_app")
        await emu.settle()

        [failed] = (await call(mcp, "list_webhook_deliveries", message_id=sent["message"]["id"]))["deliveries"]
        assert (failed["ok"], failed["status"], failed["event"]) == (False, 500, "message.received")
        assert (await call(mcp, "list_webhook_deliveries", failed_only=True))["deliveries"][0]["id"] == failed["id"]
        full = await call(mcp, "get_webhook_delivery", delivery_id=failed["id"])
        assert "telnyx-signature-ed25519" in full["request_headers"] and '"message.received"' in full["request_body"]

        replayed = await call(mcp, "replay_webhook", delivery_id=failed["id"])
        assert (replayed["ok"], replayed["status"]) == (True, 200)


async def test_sending_from_a_new_number_creates_its_inbox(emu: Emulator, fake_app: FakeApp) -> None:
    async with connect(emu) as mcp:
        sent = await call(mcp, "send_sms_to_app", inbox="+12125550123", text="Hi, is anyone there?", wait_for_delivery_seconds=0)
        assert sent["message"]["to"] == APP  # nobody texted this number yet: the app's first number
        assert (await call(mcp, "list_inboxes", channel="sms"))["inboxes"][0]["address"] == "+12125550123"
        fax = await call(mcp, "send_fax_to_app", inbox="+12125550199", title="Referral", pages=3, wait_for_delivery_seconds=0)
        assert (fax["message"]["title"], fax["message"]["pages"], fax["message"]["direction"]) == ("Referral", 3, "to_app")
        err = await fail(mcp, "send_email_to_app", inbox="+12125550123", text="x", subject="x")
        assert "is a sms inbox, not email" in err


async def test_configure_provider_checks_setting_names(emu: Emulator) -> None:
    async with connect(emu) as mcp:
        err = await fail(mcp, "configure_provider", provider="telnyx", settings={"messagingURL": "http://localhost:8000"})
        assert "Unknown setting(s) messagingURL" in err and "messagingUrl" in err
        assert "No provider 'twilio'" in await fail(mcp, "configure_provider", provider="twilio")
        done = await call(mcp, "configure_provider", provider="telnyx", settings={"messagingUrl": "http://localhost:8000/hooks/sms"})
        assert done["settings"]["messagingUrl"] == "http://localhost:8000/hooks/sms"


async def test_delete_inboxes_matches_tags_exactly(emu: Emulator) -> None:
    async with connect(emu) as mcp:
        for tag in ("run:1", "run:1", "run:10"):
            await call(mcp, "create_inbox", channel="email", tags=[tag])
        assert (await call(mcp, "delete_inboxes", tag="run:1")) == {"deleted": 2}
        left = await call(mcp, "list_inboxes", search="tag:run:1")
        assert [i["tags"] for i in left["inboxes"]] == [["run:10"]]
        assert "Pass either tag or inbox" in await fail(mcp, "delete_inboxes")


async def test_api_requests_show_why_a_send_failed(emu: Emulator, mailgun: httpx.AsyncClient) -> None:
    async with connect(emu) as mcp:
        r = await mailgun.post("/v3/wrong.test/messages", data={"from": "a@wrong.test", "to": "b@inbox.test", "subject": "Hi", "text": "x"})
        assert r.status_code == 404
        [req] = (await call(mcp, "list_api_requests", provider="mailgun"))["requests"]
        assert (req["method"], req["path"], req["status"]) == ("POST", "/v3/wrong.test/messages", 404)
        assert "Domain not found: wrong.test" in req["response"]


def test_links_keep_their_text_and_unescape_hrefs() -> None:
    html = (
        '<a class="btn" href="https://app.test/confirm?a=1&amp;b=2"><b>Confirm</b>\n  email</a>'
        '<a href="mailto:help@app.test">Email us</a><a href="https://app.test/confirm?a=1&amp;b=2">again</a>'
    )
    assert links("Or open https://app.test/other. Thanks", html) == [
        {"url": "https://app.test/confirm?a=1&b=2", "text": "Confirm email"},
        {"url": "https://app.test/other"},
    ]


async def test_mcp_endpoint_refuses_cross_site_browser_requests(control: httpx.AsyncClient) -> None:
    r = await control.post("/mcp", json={}, headers={"origin": "https://evil.example"})
    assert r.status_code == 403
