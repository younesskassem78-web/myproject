"""The authenticator-code maths, checked against the published RFC 6238 test values."""
import base64

from app import totp

RFC_SECRET = base64.b32encode(b"12345678901234567890").decode()  # the RFC's SHA-1 test key


def test_rfc6238_test_vectors():
    # RFC 6238 appendix B (8-digit SHA-1 values); 6-digit codes are their last 6 digits.
    for t, expected in ((59, "94287082"), (1111111109, "07081804"), (1111111111, "14050471"),
                        (1234567890, "89005924"), (2000000000, "69279037"), (20000000000, "65353130")):
        assert totp.code_at(RFC_SECRET, t // 30, digits=8) == expected


def test_verify_allows_small_clock_drift_and_refuses_replays():
    s = totp.new_secret()
    now = 1_800_000_000
    step = now // 30
    assert totp.verify(s, totp.code_at(s, step), now=now) == step
    assert totp.verify(s, totp.code_at(s, step - 1), now=now) == step - 1  # phone 30 s slow
    assert totp.verify(s, totp.code_at(s, step - 3), now=now) is None  # too old
    assert totp.verify(s, totp.code_at(s, step), last_step=step, now=now) is None  # already used
    assert totp.verify(s, "12345", now=now) is None and totp.verify(s, "abcdef", now=now) is None


def test_setup_uri_and_recovery_codes():
    uri = totp.setup_uri("ABC", "rana@example.com")
    assert uri.startswith("otpauth://totp/MyTerra:rana%40example.com?secret=ABC&issuer=MyTerra")
    codes = totp.recovery_codes()
    assert len(set(codes)) == 8 and all(len(c) == 9 and c[4] == "-" for c in codes)
