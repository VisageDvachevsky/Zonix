from base64 import b64decode, b64encode
from hashlib import pbkdf2_hmac
from hmac import compare_digest
from os import urandom


def hash_password(password: str) -> str:
    if not password:
        raise ValueError("password must not be empty")

    salt = urandom(16)
    derived_key = pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 600_000)
    return f"{b64encode(salt).decode('ascii')}${b64encode(derived_key).decode('ascii')}"


def verify_password(password: str, encoded_hash: str) -> bool:
    salt_b64, derived_key_b64 = encoded_hash.split("$", maxsplit=1)
    salt = b64decode(salt_b64.encode("ascii"))
    expected = b64decode(derived_key_b64.encode("ascii"))
    candidate = pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 600_000)
    return compare_digest(candidate, expected)
