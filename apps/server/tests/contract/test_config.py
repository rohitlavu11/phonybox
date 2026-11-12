"""Deployment settings that matter in Docker: where webhooks go, and which host URLs advertise."""

from __future__ import annotations

import httpx

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
