"""Deployment settings that matter in Docker and the cloud: where webhooks go, which URLs Phonybox hands out,
one port for everything, an access token, and adapter settings held fixed by the environment."""

from __future__ import annotations

import base64

import httpx
import pytest
from mcp import Client

from phonybox import store as store_module
from phonybox.__main__ import adapter_settings_from_env
from phonybox.adapters.common import make_pdf
from phonybox.clock import FrozenClock
from phonybox.config import Config
from phonybox.emulator import Emulator
from phonybox.ids import Ids
from tests.support.db import database
from tests.support.fakes import DOMAIN, START, FakeApp


async def test_webhook_base_rebases_every_default_url() -> None:
    app = FakeApp()
    emu = Emulator(Config(dataset="empty", db_path=database(), webhook_base="http://host.docker.internal:8080/"), clock=FrozenClock(START), ids=Ids(seed=1), transport=httpx.MockTransport(app.handler))
    mg = emu.store.adapter_state("mailgun")["values"]
    tx = emu.store.adapter_state("telnyx")["values"]
    assert mg["eventsUrl"] == "http://host.docker.internal:8080/webhooks/mailgun/events"
    assert mg["routeUrl"] == "http://host.docker.internal:8080/webhooks/mailgun/inbound"
    assert tx["messagingUrl"] == "http://host.docker.internal:8080/webhooks/telnyx/messaging"
    assert tx["faxUrl"] == "http://host.docker.internal:8080/webhooks/telnyx/fax"
    assert tx["messagingFailoverUrl"] == "", "unset URLs stay unset"

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=emu.mailgun), base_url="http://x", auth=("api", "k")) as mailgun:
        await mailgun.post(f"/v3/{DOMAIN}/messages", data={"from": "a@mg.acme.test", "to": "b@inbox.test", "text": "hi"})
    await emu.run_until_idle()
    assert [str(r.url) for r in app.received] == ["http://host.docker.internal:8080/webhooks/mailgun/events"]
    await emu.aclose()


def test_public_urls_never_advertise_a_wildcard_bind() -> None:
    assert Config(host="0.0.0.0").base_url(4102) == "http://127.0.0.1:4102"
    assert Config(host="0.0.0.0", public_host="phonybox").base_url(4102) == "http://phonybox:4102"
    assert Config(host="127.0.0.1").base_url(4101) == "http://127.0.0.1:4101"


def _emu(**cfg: object) -> Emulator:
    return Emulator(Config(dataset="empty", db_path=database(), **cfg), clock=FrozenClock(START), ids=Ids(seed=1), transport=httpx.MockTransport(FakeApp().handler))


async def test_one_public_url_serves_every_adapter_and_every_link_uses_it() -> None:
    """Cloud Run and friends serve one port: the adapters answer under /<id> and the links they hand out say so."""
    emu = _emu(public_url="https://phonybox.example.run.app/")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=emu.control), base_url="https://phonybox.example.run.app") as one:
        health = (await one.get("/api/health")).json()
        assert health["urls"] == {
            "control": "https://phonybox.example.run.app",
            "mailgun": "https://phonybox.example.run.app/mailgun",
            "telnyx": "https://phonybox.example.run.app/telnyx",
        }
        sent = await one.post(f"/mailgun/v3/{DOMAIN}/messages", auth=("api", "k"), data={"from": f"a@{DOMAIN}", "to": "b@inbox.test", "text": "hi"})
        assert sent.status_code == 200
        assert (await one.get("/api/inboxes/b@inbox.test")).json()["messageCount"] == 1

        fax = await one.post("/telnyx/v2/faxes", headers={"authorization": "Bearer k"}, json={"connection_id": "c", "from": "+16285550100", "to": "+14155550142", "contents": base64.b64encode(make_pdf("Payoff", 1)).decode()})
        media = (await one.get(f"/telnyx/v2/faxes/{fax.json()['data']['id']}", headers={"authorization": "Bearer k"})).json()["data"]["media_url"]
        assert media.startswith("https://phonybox.example.run.app/telnyx/fax-media/")
        assert (await one.get(media.removeprefix("https://phonybox.example.run.app"))).headers["content-type"] == "application/pdf"

    async with Client(emu.control.state.mcp) as mcp:
        setup = (await mcp.call_tool("get_setup", {})).structured_content
        assert setup is not None and setup["inspector"] == "https://phonybox.example.run.app"
        assert {p["id"]: p["api_base_url"] for p in setup["providers"]} == {
            "mailgun": "https://phonybox.example.run.app/mailgun",
            "telnyx": "https://phonybox.example.run.app/telnyx/v2",
        }
    await emu.aclose()


async def test_access_token_guards_the_inspector_api_and_mcp_but_not_health_or_the_adapters() -> None:
    emu = _emu(access_token="s3cret")

    def basic(user: str, password: str) -> dict[str, str]:
        return {"authorization": "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()}

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=emu.control), base_url="http://x") as c:
        refused = await c.get("/api/inboxes")
        assert refused.status_code == 401
        assert refused.headers["www-authenticate"].startswith("Basic ")  # the browser shows its sign-in prompt
        assert (await c.get("/mcp")).status_code == 401
        assert (await c.get("/api/inboxes", headers={"authorization": "Bearer nope"})).status_code == 401
        assert (await c.get("/api/inboxes", headers=basic("anyone", "nope"))).status_code == 401
        for granted in ({"authorization": "Bearer s3cret"}, basic("anyone", "s3cret"), basic("s3cret", "")):
            assert (await c.get("/api/inboxes", headers=granted)).status_code == 200

        assert (await c.get("/api/health")).status_code == 200
        # The adapters keep their providers' own auth: the app under test never needs the token.
        sent = await c.post(f"/mailgun/v3/{DOMAIN}/messages", auth=("api", "k"), data={"from": f"a@{DOMAIN}", "to": "b@inbox.test", "text": "hi"})
        assert sent.status_code == 200

    async with Client(emu.control.state.mcp) as mcp:  # the MCP tools call the control API with the token
        result = await mcp.call_tool("list_inboxes", {})
        assert not result.is_error, result.content
    await emu.aclose()


async def test_the_environment_holds_adapter_settings_fixed() -> None:
    env = {
        "PHONYBOX_MAILGUN__API_KEY": "mg-secret",
        "PHONYBOX_MAILGUN__ACCEPT_ANY_KEY": "false",
        "PHONYBOX_TELNYX__MESSAGING_URL": "https://app.test/webhooks/telnyx",
        "PHONYBOX_TELNYX__API_KEY": "tx-secret",
        "PHONYBOX_TELNYX__ACCEPT_ANY_KEY": "0",
        "PHONYBOX_TELNYX_PORT": "4102",  # flags are not settings
        "PHONYBOX_TELNYX_KEY_SEED": "seed",
    }
    pinned = adapter_settings_from_env(env, ["mailgun", "telnyx"])
    assert pinned == {
        "mailgun": {"apiKey": "mg-secret", "acceptAnyKey": "false"},
        "telnyx": {"messagingUrl": "https://app.test/webhooks/telnyx", "apiKey": "tx-secret", "acceptAnyKey": "0"},
    }

    emu = _emu(adapter_settings=pinned)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=emu.control), base_url="http://x") as c:
        form = {"from": f"a@{DOMAIN}", "to": "b@inbox.test", "text": "hi"}
        assert (await c.post(f"/mailgun/v3/{DOMAIN}/messages", auth=("api", "guess"), data=form)).status_code == 401
        assert (await c.post(f"/mailgun/v3/{DOMAIN}/messages", auth=("api", "mg-secret"), data=form)).status_code == 200
        assert (await c.get("/telnyx/v2/phone_numbers", headers={"authorization": "Bearer tx-secre"})).status_code == 401
        assert (await c.get("/telnyx/v2/phone_numbers", headers={"authorization": "Bearer tx-secret"})).status_code == 200

        await c.post("/api/reset", json={})
        assert emu.store.adapter_state("telnyx")["values"]["messagingUrl"] == "https://app.test/webhooks/telnyx", "a reset keeps them"
    await emu.aclose()

    with pytest.raises(ValueError, match="no setting 'apiKy'"):
        _emu(adapter_settings={"mailgun": {"apiKy": "x"}})


async def test_the_api_log_keeps_only_the_newest_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    """The log records every call an adapter gets, refused ones too, so on the internet it must stay bounded."""
    monkeypatch.setattr(store_module, "MAX_REQUESTS", 3)
    emu = _emu()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=emu.control), base_url="http://x") as c:
        for n in range(5):
            await c.post(f"/telnyx/anything-{n}")  # no key: refused, and logged
        paths = [r["path"] for r in (await c.get("/api/requests")).json()["items"]]
    assert sorted(paths) == ["/telnyx/anything-2", "/telnyx/anything-3", "/telnyx/anything-4"]
    await emu.aclose()
