"""MCP over the real transports: Streamable HTTP at /mcp, and `phonybox mcp` over stdio.

The deterministic behavior of each tool is in tests/contract/test_mcp.py; these prove
an MCP client can actually connect, and that waits and webhook results work in real time.
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

import httpx
from mcp import Client, StdioServerParameters

from tests.support.live import Live

APP = "+16285550100"


async def call(mcp: Client, tool: str, **args: Any) -> Any:
    result = await mcp.call_tool(tool, args)
    assert not result.is_error, result.content[0].text  # type: ignore[union-attr]
    return result.structured_content


async def test_http_mcp_waits_for_a_text_and_reports_the_apps_webhook_response(live: Live) -> None:
    async with Client(f"{live.url('control')}/mcp") as mcp:
        assert "wait_for_message" in {t.name for t in (await mcp.list_tools()).tools}

        # Start waiting before the number has an inbox; the app's text creates it.
        number = "+14155550177"
        waiting = asyncio.create_task(call(mcp, "wait_for_message", inbox=number, timeout_seconds=10))
        await asyncio.sleep(0.5)
        async with httpx.AsyncClient(base_url=live.url("telnyx"), headers={"authorization": "Bearer k"}) as telnyx:
            r = await telnyx.post("/v2/messages", json={"from": APP, "to": number, "text": "Your Acme code is 654321"})
            r.raise_for_status()
        got = await asyncio.wait_for(waiting, 10)
        assert (got["codes"], got["from"]) == (["654321"], APP)

        # Reply as the person; the sink (the app) answers 200 and the tool reports it.
        sent = await call(mcp, "send_sms_to_app", inbox=number, text="STOP")
        assert sent["webhook"]["ok"] and sent["webhook"]["status"] == 200
        assert sent["webhook"]["url"].endswith("/tx/messaging") and sent["webhook"]["event"] == "message.received"
        assert any(path == "/tx/messaging" and b"STOP" in body for path, _, body in live.sink.received)

        # Browsers on other sites can't reach it.
        async with httpx.AsyncClient() as h:
            r = await h.post(f"{live.url('control')}/mcp", json={}, headers={"origin": "https://evil.example"})
            assert r.status_code == 403


async def test_stdio_mcp_uses_a_running_phonybox(live: Live) -> None:
    server = StdioServerParameters(command=sys.executable, args=["-m", "phonybox", "mcp", "--url", live.url("control")])
    async with Client(server) as mcp:
        setup = await call(mcp, "get_setup")
        providers = {p["id"]: p for p in setup["providers"]}
        assert providers["telnyx"]["api_base_url"] == f"{live.url('telnyx')}/v2"
        assert setup["inspector"] == live.url("control")
        box = await call(mcp, "create_inbox", channel="email", tags=["run:stdio"])
        assert (await call(mcp, "delete_inboxes", tag="run:stdio")) == {"deleted": 1}
        assert box["address"].endswith("@inbox.test")
