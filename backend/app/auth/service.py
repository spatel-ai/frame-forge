"""Account rules: sign up, log in and out, sessions, change password (T-202).

Never log a password, token or email here (backend/CLAUDE.md). Errors are ApiError, so no
auth-specific handler is needed."""

import hashlib
import logging
import re
import secrets
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from ..core.config import Settings
from ..core.errors import ApiError
from . import passwords
from .email import EmailSender
from .schemas import ChangePasswordIn, LoginIn, SignupIn, UserOut
from .store import AuthStore, EmailTaken

log = logging.getLogger(__name__)

VERIFY_TOKEN_HOURS = 24
_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _invalid(fields: dict[str, str]) -> ApiError:
    return ApiError(422, next(iter(fields.values())), "validation_error", fields=fields)


def _password_problem(password: str) -> str | None:
    if len(password) < 10:
        return "At least 10 characters."
    if len(password) > 128:
        return "No more than 128 characters."
    return None


def _wrong_credentials() -> ApiError:
    return ApiError(401, "Email or password is wrong.", "invalid_credentials")


class AuthService:
    def __init__(
        self,
        settings: Settings,
        store: AuthStore,
        email_sender: EmailSender,
        clock: Callable[[], datetime] = utcnow,
    ):
        self.settings = settings
        self.store = store
        self.email_sender = email_sender
        self.now = clock

    @property
    def session_seconds(self) -> int:
        return self.settings.session_days * 86400

    # sign up / log in ------------------------------------------------------------------

    def signup(self, body: SignupIn) -> tuple[UserOut, str]:
        """Returns the new user and the session token to put in the cookie."""
        name = body.name.strip()
        email = body.email.strip().lower()
        errors: dict[str, str] = {}
        if not 1 <= len(name) <= 80:
            errors["name"] = "Enter your name, up to 80 characters."
        if len(email) > 254 or not _EMAIL.fullmatch(email):
            errors["email"] = "Enter a full email address, like name@example.com."
        if problem := _password_problem(body.password):
            errors["password"] = problem
        if errors:
            raise _invalid(errors)

        now = self.now()
        session_token = secrets.token_urlsafe(32)
        verify_token = secrets.token_urlsafe(32)
        # Fast pre-check so a taken email does not cost a hash; the unique index decides a race.
        if self.store.get_user_by_email(email):
            raise self._email_taken()
        try:
            user, session_id = self.store.create_account(
                name=name,
                email=email,
                password_hash=passwords.hash_password(body.password),
                session_token_hash=hash_token(session_token),
                session_expires_at=now + timedelta(seconds=self.session_seconds),
                verify_token_hash=hash_token(verify_token),
                verify_expires_at=now + timedelta(hours=VERIFY_TOKEN_HOURS),
                now=now,
            )
        except EmailTaken:
            raise self._email_taken() from None
        self.send_verification_email(email, verify_token)
        return self._user_out(user), session_token

    @staticmethod
    def _email_taken() -> ApiError:
        return ApiError(
            409,
            "An account with this email already exists. Log in, or reset your password "
            "if you forgot it.",
            "email_taken",
        )

    def create_verification_token(self, user_id: str) -> str:
        """A new confirmation token; earlier unused ones stop working. Only its hash is stored."""
        token = secrets.token_urlsafe(32)
        now = self.now()
        self.store.replace_email_token(
            user_id,
            "verify",
            hash_token(token),
            now,
            now + timedelta(hours=VERIFY_TOKEN_HOURS),
        )
        return token

    def send_verification_email(self, email: str, token: str) -> None:
        link = f"{self.settings.app_base_url}/verify-email?token={token}"
        body = (
            "Welcome to Frameforge.\n\nConfirm your email address by opening this link "
            f"within {VERIFY_TOKEN_HOURS} hours:\n{link}\n"
        )
        try:
            self.email_sender.send(email, "Confirm your email address", body)
        except Exception:
            # The account exists; the customer can ask for another email. No address in the log.
            log.error("Could not send a confirmation email", exc_info=True)

    def login(self, body: LoginIn) -> tuple[UserOut, str]:
        email = body.email.strip().lower()
        password = body.password
        user = self.store.get_user_by_email(email) if len(password) <= 128 else None
        if user is None:
            passwords.burn_verification_time(password[:128])
            raise _wrong_credentials()
        if not passwords.verify_password(user["password_hash"], password):
            raise _wrong_credentials()
        if user["status"] != "active":
            raise _wrong_credentials()
        if passwords.needs_rehash(user["password_hash"]):
            self.store.set_password_hash(user["id"], passwords.hash_password(password))
        token, _ = self._new_session(user["id"])
        self.store.audit("login", self.now(), actor_user_id=user["id"], target=user["id"])
        return self._user_out(user), token

    def _new_session(self, user_id: str) -> tuple[str, str]:
        token = secrets.token_urlsafe(32)
        now = self.now()
        session_id = self.store.create_session(
            user_id,
            hash_token(token),
            now,
            now + timedelta(seconds=self.session_seconds),
        )
        return token, session_id

    # sessions --------------------------------------------------------------------------

    def authenticate(self, token: str | None) -> dict | None:
        """The session row joined with its user, or None."""
        if not token:
            return None
        return self.store.find_active_session(hash_token(token), self.now())

    def logout(self, token: str | None) -> None:
        if token:
            self.store.revoke_session(hash_token(token), self.now())

    def logout_all(self, user_id: str) -> None:
        now = self.now()
        self.store.revoke_user_sessions(user_id, now)
        self.store.audit("logout_all", now, actor_user_id=user_id, target=user_id)

    def me(self, user_id: str) -> UserOut:
        user = self.store.get_user(user_id)
        assert user is not None  # the session's user exists (foreign key)
        return self._user_out(user)

    def change_password(self, user_id: str, session_id: str, body: ChangePasswordIn) -> None:
        errors: dict[str, str] = {}
        if problem := _password_problem(body.new_password):
            errors["new_password"] = problem
        stored = self.store.get_user(user_id)
        if stored is None or not (
            len(body.current_password) <= 128
            and passwords.verify_password(stored["password_hash"], body.current_password)
        ):
            errors["current_password"] = "That is not your current password."
        if errors:
            raise _invalid(errors)
        now = self.now()
        self.store.set_password_hash(user_id, passwords.hash_password(body.new_password))
        self.store.revoke_user_sessions(user_id, now, except_id=session_id)
        self.store.audit("password_change", now, actor_user_id=user_id, target=user_id)

    # ------------------------------------------------------------------------------------

    def _user_out(self, user: dict) -> UserOut:
        return UserOut(
            id=user["id"],
            name=user["name"],
            email=user["email"],
            email_verified=user["email_verified_at"] is not None,
            role=user["role"],
            active_sessions=self.store.count_active_sessions(user["id"], self.now()),
        )
