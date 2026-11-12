"""Webhook signing, done the way each provider documents it.

Mailgun: hex(HMAC-SHA256(key=webhook signing key, msg=timestamp + token)).
  https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks
Telnyx: base64(Ed25519.sign(f"{timestamp}|{raw_body}")), sent as
  `telnyx-signature-ed25519` with `telnyx-timestamp`; apps verify with the
  account's public key.
  https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks
"""

from __future__ import annotations

import base64
import hashlib
import hmac

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat


def mailgun_signature(signing_key: str, timestamp: str, token: str) -> str:
    return hmac.new(signing_key.encode(), f"{timestamp}{token}".encode(), hashlib.sha256).hexdigest()


class TelnyxSigner:
    """Ed25519 key pair derived from a seed string, so the public key is stable."""

    def __init__(self, seed: str) -> None:
        self._key = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(seed.encode()).digest())
        raw = self._key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        self.public_key_b64 = base64.b64encode(raw).decode()

    def sign(self, timestamp: str, body: bytes) -> str:
        return base64.b64encode(self._key.sign(timestamp.encode() + b"|" + body)).decode()


def verify_telnyx(public_key_b64: str, signature_b64: str, timestamp: str, body: bytes) -> bool:
    """Reference verification, as an app would do it. Used by the contract tests."""
    key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
    try:
        key.verify(base64.b64decode(signature_b64), timestamp.encode() + b"|" + body)
        return True
    except Exception:
        return False
