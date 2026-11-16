"""Password hashing with Argon2id (D-034), using argon2-cffi's default parameters."""

from functools import lru_cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(stored_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    return _hasher.check_needs_rehash(stored_hash)


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    return _hasher.hash("frameforge-dummy-password")


def burn_verification_time(password: str) -> None:
    """Login for an unknown email: do one real verification against a fixed hash, so the answer
    takes as long as for a real account."""
    verify_password(_dummy_hash(), password)
