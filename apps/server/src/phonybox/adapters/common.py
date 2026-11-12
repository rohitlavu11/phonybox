"""Helpers shared by provider adapters."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, Request, Response
from starlette.datastructures import UploadFile

from ..clock import iso

if TYPE_CHECKING:
    from ..emulator import Emulator

MAX_LOGGED_BODY = 16_384


def stable_hex(*parts: str, length: int = 32) -> str:
    """Id derived from content, for values that must stay the same across retries."""
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:length]


def stable_uuid(*parts: str) -> str:
    h = stable_hex(*parts, length=32)
    return f"{h[:8]}-{h[8:12]}-4{h[13:16]}-a{h[17:20]}-{h[20:32]}"


def csv(value: Any) -> list[str]:
    return [v.strip() for v in str(value or "").split(",") if v.strip()]


async def summarize_form(request: Request) -> str:
    """Form bodies as `key=value` lines (files as `key=@name (size)`), for the API log."""
    form = await request.form()
    lines = []
    for key, value in form.multi_items():
        if isinstance(value, UploadFile):
            size = len(await value.read())
            await value.seek(0)
            lines.append(f"{key}=@{value.filename} ({size} bytes)")
        else:
            text = str(value)
            lines.append(f"{key}={text if len(text) <= 500 else text[:500] + '…'}")
    return "\n".join(lines)


def install_request_log(app: FastAPI, emu: Emulator, adapter_id: str, disabled: Callable[[], Response]) -> None:
    """Record every call into the API log, and refuse calls while the adapter is off."""

    @app.middleware("http")
    async def log(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        at = emu.clock.now()
        t0 = emu.clock.monotonic()
        request.state.related_id = None
        request.state.log_body = None
        ctype = request.headers.get("content-type", "")
        raw = await request.body()

        if not emu.store.adapter_state(adapter_id)["enabled"]:
            response = disabled()
            body = bytes(response.body)
        else:
            response = await call_next(request)
            chunks = [c async for c in response.body_iterator]  # type: ignore[attr-defined]
            body = b"".join(c if isinstance(c, bytes) else c.encode() for c in chunks)
            response = Response(content=body, status_code=response.status_code, headers=dict(response.headers), media_type=response.media_type)

        logged_req = request.state.log_body
        if logged_req is None and raw:
            logged_req = "(binary body)" if "multipart" in ctype else raw[:MAX_LOGGED_BODY].decode("utf-8", errors="replace")
        path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
        record: dict[str, Any] = {
            "id": emu.ids.short("rq"),
            "adapterId": adapter_id,
            "method": request.method if request.method in ("GET", "POST", "PUT", "PATCH", "DELETE") else "GET",
            "path": path,
            "status": response.status_code,
            "durationMs": int(round((emu.clock.monotonic() - t0) * 1000)),
            "createdAt": iso(at),
        }
        if request.state.related_id:
            record["relatedId"] = request.state.related_id
        if logged_req:
            record["requestBody"] = _pretty(logged_req)
        if body:
            record["responseBody"] = _pretty(body[:MAX_LOGGED_BODY].decode("utf-8", errors="replace"))
        emu.store.add_request(record)
        return response


def _pretty(text: str) -> str:
    try:
        return json.dumps(json.loads(text), indent=2)
    except (ValueError, TypeError):
        return text


def multipart(fields: list[tuple[str, str]], boundary: str) -> tuple[str, bytes]:
    """multipart/form-data with a caller-chosen boundary, so the bytes are reproducible."""
    out = bytearray()
    for name, value in fields:
        out += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n".encode()
        out += value.encode() + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return f"multipart/form-data; boundary={boundary}", bytes(out)


def make_pdf(title: str, pages: int) -> bytes:
    """A small, valid, deterministic PDF: one line of text per page."""
    pages = max(1, min(pages, 50))
    objs: list[bytes] = []
    kids = " ".join(f"{3 + i * 2} 0 R" for i in range(pages))
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>".encode())
    font_ref = 3 + pages * 2
    for i in range(pages):
        text = f"{title} - page {i + 1} of {pages}".replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = f"BT /F1 14 Tf 72 720 Td ({text}) Tj ET".encode("latin-1", errors="replace")
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {4 + i * 2} 0 R /Resources << /Font << /F1 {font_ref} 0 R >> >> >>".encode())
        objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, obj in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def pdf_page_count(data: bytes) -> int:
    import re

    return max(1, len(re.findall(rb"/Type\s*/Page(?!s)", data)))
