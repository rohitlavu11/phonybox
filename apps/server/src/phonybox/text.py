"""Small text helpers shared by adapters and the control API."""

from __future__ import annotations

import re
from email.utils import getaddresses

# ------------------------------------------------------------------ extraction

_CODE_CONTEXT = re.compile(r"\b(code|otp|pin|passcode|verification)\b", re.I)
_LINK = re.compile(r"https?://[^\s\"'<>)]+")
_CODE = re.compile(r"\b(\d{3})[ -]?(\d{3})\b|\b(\d{4,8})\b")
_YEAR = re.compile(r"^(19|20)\d{2}$")


def extract(text: str) -> dict[str, list[str]]:
    """One-time codes and links, same rules as the UI (apps/web/src/lib/extract.ts)."""
    links = list(dict.fromkeys(_LINK.findall(text)))
    prose = re.sub(r"https?://\S+", " ", text)
    codes: list[str] = []
    if _CODE_CONTEXT.search(prose):
        for m in _CODE.finditer(prose):
            code = m.group(3) or f"{m.group(1)}{m.group(2)}"
            if code not in codes and not _YEAR.match(code):
                codes.append(code)
    return {"codes": codes[:2], "links": links[:3]}


# --------------------------------------------------------------------- email

def parse_addresses(values: list[str]) -> list[dict[str, str]]:
    """'A <a@x.test>, b@x.test' (possibly repeated) -> [{name?, address}] (deduped, lowercased)."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for name, addr in getaddresses(values):
        addr = addr.strip().lower()
        if not addr or "@" not in addr or addr in seen:
            continue
        seen.add(addr)
        out.append({"name": name, "address": addr} if name else {"address": addr})
    return out


def format_address(a: dict[str, str]) -> str:
    return f"{a['name']} <{a['address']}>" if a.get("name") else a["address"]


# ----------------------------------------------------------------------- sms

_GSM7 = set(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?"
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
)
_GSM7_EXT = set("^{}\\[~]|€")


def sms_encoding(text: str) -> tuple[str, int]:
    """(encoding, parts) the way carriers segment: GSM-7 160/153, UCS-2 70/67."""
    if all(c in _GSM7 or c in _GSM7_EXT for c in text):
        units = sum(2 if c in _GSM7_EXT else 1 for c in text)
        return "GSM-7", 1 if units <= 160 else -(-units // 153)
    units = sum(2 if ord(c) > 0xFFFF else 1 for c in text)
    return "UCS-2", 1 if units <= 70 else -(-units // 67)


E164 = re.compile(r"^\+[1-9]\d{7,14}$")

STOP_WORDS = {"stop", "stopall", "unsubscribe", "cancel", "end", "quit"}
START_WORDS = {"start", "unstop", "yes"}
