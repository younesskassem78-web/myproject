"""Time-based one-time passwords (RFC 6238), the 6-digit codes from authenticator apps. Standard library only."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

STEP = 30  # seconds per code
DIGITS = 6


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def code_at(secret: str, step: int, digits: int = DIGITS) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(number % 10 ** digits).zfill(digits)


def verify(secret: str, code: str, last_step: int | None = None, now: float | None = None) -> int | None:
    """The time step the code belongs to (allowing one step of clock drift either way), or None.
    A step at or before `last_step` was already used: refusing it stops a seen code being replayed."""
    code = code.strip().replace(" ", "")
    if not (code.isdigit() and len(code) == DIGITS):
        return None
    current = int((time.time() if now is None else now) // STEP)
    for step in (current, current - 1, current + 1):
        if (last_step is None or step > last_step) and hmac.compare_digest(code_at(secret, step), code):
            return step
    return None


def setup_uri(secret: str, account: str, issuer: str = "MyTerra") -> str:
    """What the QR code holds: authenticator apps read it to add the account."""
    return (f"otpauth://totp/{quote(issuer)}:{quote(account)}?secret={secret}&issuer={quote(issuer)}"
            f"&algorithm=SHA1&digits={DIGITS}&period={STEP}")


def recovery_codes(n: int = 8) -> list[str]:
    """One-time backup codes like 'k7m2-q9x4', for when the phone is lost."""
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"  # no 0/o or 1/l/i to misread
    return ["-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(2)) for _ in range(n)]
