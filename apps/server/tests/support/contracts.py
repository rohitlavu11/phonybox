"""Contract assertions, written from the providers' documentation rather than from
the emulator's code: JSON Schemas in contracts/providers, and signature checks
implemented the way an app would implement them."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from email.parser import BytesParser
from email.policy import default as default_policy
from functools import cache
from typing import Any

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from tests.support import CONTRACTS

SCHEMAS = CONTRACTS / "providers"


@cache
def _registry() -> Registry:
    resources = [(p.name, Resource.from_contents(json.loads(p.read_text()))) for p in SCHEMAS.glob("*.schema.json")]
    return Registry().with_resources(resources)


def conforms(schema: str, instance: Any) -> None:
    """Fail with every violation listed, not just the first."""
    validator = Draft202012Validator({"$ref": f"{schema}.schema.json"}, registry=_registry(), format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.absolute_path))
    assert not errors, f"{schema}:\n" + "\n".join(f"  {'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message}" for e in errors)


def form_fields(request: httpx.Request) -> dict[str, str]:
    """Parse multipart/form-data the way a web framework would."""
    ctype = request.headers["content-type"]
    assert ctype.startswith("multipart/form-data; boundary="), ctype
    msg = BytesParser(policy=default_policy).parsebytes(f"Content-Type: {ctype}\r\n\r\n".encode() + request.content)
    out: dict[str, str] = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        out[str(name)] = part.get_payload(decode=True).decode()  # type: ignore[union-attr]
    return out


def mailgun_signature_ok(signing_key: str, sig: dict[str, str]) -> bool:
    expected = hmac.new(signing_key.encode(), (sig["timestamp"] + sig["token"]).encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig["signature"])


def telnyx_signature_ok(public_key_b64: str, request: httpx.Request) -> bool:
    key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
    ts = request.headers["telnyx-timestamp"]
    try:
        key.verify(base64.b64decode(request.headers["telnyx-signature-ed25519"]), ts.encode() + b"|" + request.content)
        return True
    except Exception:
        return False
