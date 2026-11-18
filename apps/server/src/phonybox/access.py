"""An optional shared token in front of the inspector, the control API and /mcp.

Phonybox has no user accounts. Where people other than you can reach it (a shared staging
box, Cloud Run), set PHONYBOX_ACCESS_TOKEN and every request to the control port needs it,
except:

  /api/health        so a platform's health check works
  /<adapter id>/...  the adapters, which check their providers' own credentials

The token is accepted as `Authorization: Bearer <token>` (curl, MCP clients, scripts) or as
either half of HTTP Basic credentials, so a browser signs in with its own password prompt
and then sends it with every request, the event stream included.
"""

from __future__ import annotations

import base64
import binascii
import hmac

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

OPEN_PATHS = frozenset({"/api/health"})
REFUSED = (
    "This Phonybox needs its access token. Send Authorization: Bearer <token>, "
    "or sign in with any username and the token as the password."
)


class RequireAccessToken:
    def __init__(self, app: ASGIApp, token: str, open_prefixes: tuple[str, ...] = ()) -> None:
        self.app = app
        self.token = token.encode()
        self.open_prefixes = open_prefixes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan" or self._open(scope["path"]) or self._granted(Headers(scope=scope).get("authorization", "")):
            await self.app(scope, receive, send)
        elif scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
        else:
            refused = JSONResponse({"detail": REFUSED}, status_code=401, headers={"www-authenticate": 'Basic realm="Phonybox", charset="UTF-8"'})
            await refused(scope, receive, send)

    def _open(self, path: str) -> bool:
        return path in OPEN_PATHS or any(path == p or path.startswith(p + "/") for p in self.open_prefixes)

    def _granted(self, header: str) -> bool:
        scheme, _, value = header.partition(" ")
        if scheme.lower() == "bearer":
            return self._matches(value.strip().encode())
        if scheme.lower() == "basic":
            try:
                user, _, password = base64.b64decode(value.strip(), validate=True).partition(b":")
            except (binascii.Error, ValueError):
                return False
            return self._matches(user) or self._matches(password)
        return False

    def _matches(self, candidate: bytes) -> bool:
        return hmac.compare_digest(candidate, self.token)
