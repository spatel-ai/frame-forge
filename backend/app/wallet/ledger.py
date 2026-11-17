"""The ledger service (task T-302): the ONLY code that writes `wallets` or `ledger_entries`
(backend rule 1).

Every operation takes a SQLAlchemy `Connection` that is already inside a transaction and never
commits, so a caller can commit a job's status change and its ledger entry together (HLD §5.2,
rule 3). Each operation:

1. locks the user's wallet row (`SELECT … FOR UPDATE`), creating it first if missing;
2. returns the existing entry, changing nothing, if this (kind, ref_type, ref_id) is already
   written (rule 9);
3. checks its rules, raising before any write so the caller's transaction stays usable;
4. updates the wallet; 5. inserts the entry with the after-values.

Because every ledger write for a user happens under that user's wallet lock, the checks in 2 and
3 cannot race. The database CHECK and UNIQUE constraints (migration 0004) are the last line of
defence, not the primary check. Amounts are integers only (rule 6, D-014).

Available credits = balance − reserved (HLD §4)."""

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import Connection, Engine, Row, Table, func, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .models import LedgerEntry, Wallet

_wallets: Table = Wallet.__table__  # type: ignore[assignment]
_entries: Table = LedgerEntry.__table__  # type: ignore[assignment]

JOB = "job"
GRANT = "grant"
PAYMENT = "payment"


class InsufficientCredits(Exception):
    """Fewer credits are available than the operation needs. Nothing was written."""

    def __init__(self, required: int, available: int):
        super().__init__(f"required {required} credits, available {available}")
        self.required = required
        self.available = available


class LedgerConflict(Exception):
    """The operation contradicts the ledger: no hold to capture, a capture after a release, an
    entry for this reference that belongs to another user or has another amount. Nothing was
    written."""


@dataclass(frozen=True)
class Entry:
    id: str
    user_id: str
    kind: str
    credits: int  # signed change to the balance
    reserved_delta: int  # signed change to reserved
    balance_after: int
    reserved_after: int
    ref_type: str
    ref_id: str
    created_by: str | None
    created_at: datetime

    @property
    def job_id(self) -> str | None:
        """The bare job id: a hold, capture or release reference `<job_id>#<attempt>` (D-039) is
        cut at `#`."""
        return self.ref_id.split("#", 1)[0] if self.ref_type == JOB else None


@dataclass(frozen=True)
class WalletBalance:
    balance_credits: int
    reserved_credits: int
    available_credits: int


# ---- helpers -----------------------------------------------------------------------------


def _amount(credits: object) -> int:
    """A positive whole number of credits. bool is an int subclass and is refused too."""
    if isinstance(credits, bool) or not isinstance(credits, int):
        raise TypeError(f"credits must be an int, not {type(credits).__name__}")
    if credits <= 0:
        raise ValueError("credits must be greater than 0")
    return credits


def _attempt_ref(job_id: str, attempt: object) -> str:
    """The reference of one approval attempt of a job: `<job_id>#<attempt>` (D-039). The voice
    charge and return keep the bare job id, because a job has one voice."""
    if isinstance(attempt, bool) or not isinstance(attempt, int):
        raise TypeError(f"attempt must be an int, not {type(attempt).__name__}")
    if attempt < 1:
        raise ValueError("attempt must be at least 1")
    if "#" in job_id:
        raise ValueError("a job id cannot contain '#'")
    return f"{job_id}#{attempt}"


def _require_transaction(conn: Connection) -> None:
    if not conn.in_transaction():
        raise RuntimeError("ledger operations need a connection inside a transaction")


def _entry(row: Row) -> Entry:
    return Entry(**row._mapping)


def _lock(conn: Connection, user_id: str) -> tuple[int, int]:
    """Create the wallet row if missing, lock it until the transaction ends, and return
    (balance, reserved) as read under the lock."""
    conn.execute(
        pg_insert(_wallets)
        .values(user_id=user_id)
        .on_conflict_do_nothing(index_elements=["user_id"])
    )
    row = conn.execute(
        select(_wallets.c.balance_credits, _wallets.c.reserved_credits)
        .where(_wallets.c.user_id == user_id)
        .with_for_update()
    ).one()
    return row.balance_credits, row.reserved_credits


def _find(conn: Connection, user_id: str, kind: str, ref_type: str, ref_id: str) -> Entry | None:
    """The entry for (kind, ref_type, ref_id), if any. One that belongs to another user is a
    conflict, never a match."""
    row = conn.execute(
        select(_entries).where(
            _entries.c.kind == kind, _entries.c.ref_type == ref_type, _entries.c.ref_id == ref_id
        )
    ).first()
    if row is None:
        return None
    entry = _entry(row)
    if entry.user_id != user_id:
        raise LedgerConflict(f"{kind} for {ref_type} {ref_id} belongs to another user")
    return entry


def _same_or_conflict(entry: Entry, credits: int, reserved_delta: int) -> Entry:
    """A repeat must be the same request. A different amount for the same reference is a bug in
    the caller; refuse it rather than hide it."""
    if entry.credits != credits or entry.reserved_delta != reserved_delta:
        raise LedgerConflict(
            f"{entry.kind} for {entry.ref_type} {entry.ref_id} already written with another amount"
        )
    return entry


def _write(
    conn: Connection,
    user_id: str,
    kind: str,
    ref_type: str,
    ref_id: str,
    credits: int,
    reserved_delta: int,
    created_by: str | None = None,
) -> Entry:
    # Relative update: even if the row lock were ever bypassed, a stale read could not overwrite
    # another writer's change, and the CHECK would see the true combined result.
    now = datetime.now(timezone.utc)
    after = conn.execute(
        update(_wallets)
        .where(_wallets.c.user_id == user_id)
        .values(
            balance_credits=_wallets.c.balance_credits + credits,
            reserved_credits=_wallets.c.reserved_credits + reserved_delta,
            updated_at=now,
        )
        .returning(_wallets.c.balance_credits, _wallets.c.reserved_credits)
    ).one()
    balance_after, reserved_after = after.balance_credits, after.reserved_credits
    row = conn.execute(
        insert(_entries)
        .values(
            id=uuid.uuid4().hex,
            user_id=user_id,
            kind=kind,
            credits=credits,
            reserved_delta=reserved_delta,
            balance_after=balance_after,
            reserved_after=reserved_after,
            ref_type=ref_type,
            ref_id=ref_id,
            created_by=created_by,
            created_at=now,
        )
        .returning(*_entries.c)
    ).one()
    return _entry(row)


def _ensure_available(current: tuple[int, int], required: int) -> None:
    available = current[0] - current[1]
    if available < required:
        raise InsufficientCredits(required=required, available=available)


# ---- operations (inside the caller's transaction) ----------------------------------------


def grant(
    conn: Connection, user_id: str, credits: int, ref_id: str, created_by: str | None
) -> Entry:
    """Add `credits` to the balance. Reference ('grant', ref_id)."""
    credits = _amount(credits)
    _require_transaction(conn)
    _lock(conn, user_id)
    existing = _find(conn, user_id, "grant", GRANT, ref_id)
    if existing:
        return _same_or_conflict(existing, credits, 0)
    return _write(conn, user_id, "grant", GRANT, ref_id, credits, 0, created_by)


def purchase(conn: Connection, user_id: str, credits: int, ref_id: str) -> Entry:
    """Add `credits` bought with a Razorpay payment. Reference ('payment', <razorpay payment id>),
    so one payment is credited once (rule 9). Called only by the payments crediting routine
    (`app.payments.service.credit_order`, backend rule 7), after it has checked the signature,
    the `captured` status and the amount."""
    credits = _amount(credits)
    _require_transaction(conn)
    _lock(conn, user_id)
    existing = _find(conn, user_id, "purchase", PAYMENT, ref_id)
    if existing:
        return _same_or_conflict(existing, credits, 0)
    return _write(conn, user_id, "purchase", PAYMENT, ref_id, credits, 0)


def voice_charge(conn: Connection, user_id: str, job_id: str, credits: int) -> Entry:
    """Take `credits` from the balance for a job's voice (D-038). Raises InsufficientCredits if
    fewer are available."""
    credits = _amount(credits)
    _require_transaction(conn)
    current = _lock(conn, user_id)
    existing = _find(conn, user_id, "voice_charge", JOB, job_id)
    if existing:
        return _same_or_conflict(existing, -credits, 0)
    _ensure_available(current, credits)
    return _write(conn, user_id, "voice_charge", JOB, job_id, -credits, 0)


def voice_return(conn: Connection, user_id: str, job_id: str) -> Entry:
    """Return the job's voice charge, by the amount recorded on it. Raises LedgerConflict if
    the job has no voice charge."""
    _require_transaction(conn)
    _lock(conn, user_id)
    existing = _find(conn, user_id, "voice_return", JOB, job_id)
    if existing:
        return existing
    charge = _find(conn, user_id, "voice_charge", JOB, job_id)
    if charge is None:
        raise LedgerConflict(f"no voice charge to return for job {job_id}")
    return _write(conn, user_id, "voice_return", JOB, job_id, -charge.credits, 0)


def hold(conn: Connection, user_id: str, job_id: str, credits: int, attempt: int) -> Entry:
    """Reserve `credits` for approval `attempt` (1, 2, ...) of a job's video (D-005, D-039),
    under the reference `<job_id>#<attempt>`. Raises InsufficientCredits if fewer are available.
    Raises LedgerConflict if this attempt's hold was already captured or released: a second hold
    for the same attempt cannot be written (UNIQUE (kind, ref_type, ref_id)), and returning the
    old one would pretend credits are reserved when they are not. A new approval uses a new
    attempt."""
    credits = _amount(credits)
    ref = _attempt_ref(job_id, attempt)
    _require_transaction(conn)
    current = _lock(conn, user_id)
    existing = _find(conn, user_id, "hold", JOB, ref)
    if existing:
        for settled in ("capture", "release"):
            if _find(conn, user_id, settled, JOB, ref):
                raise LedgerConflict(f"the hold for job {ref} was already {settled}d")
        return _same_or_conflict(existing, 0, credits)
    _ensure_available(current, credits)
    return _write(conn, user_id, "hold", JOB, ref, 0, credits)


def _settle(
    conn: Connection, user_id: str, job_id: str, attempt: int, kind: str, other: str
) -> Entry:
    ref = _attempt_ref(job_id, attempt)
    _require_transaction(conn)
    _lock(conn, user_id)
    existing = _find(conn, user_id, kind, JOB, ref)
    if existing:
        return existing
    if _find(conn, user_id, other, JOB, ref):
        raise LedgerConflict(f"the hold for job {ref} was already {other}d")
    held = _find(conn, user_id, "hold", JOB, ref)
    if held is None:
        raise LedgerConflict(f"no hold to {kind} for job {ref}")
    amount = held.reserved_delta
    credits = -amount if kind == "capture" else 0
    return _write(conn, user_id, kind, JOB, ref, credits, -amount)


def capture(conn: Connection, user_id: str, job_id: str, attempt: int) -> Entry:
    """Take the amount held for this attempt (as recorded on the hold) from balance and
    reserved. Raises LedgerConflict if the attempt has no hold or it was released."""
    return _settle(conn, user_id, job_id, attempt, "capture", "release")


def release(conn: Connection, user_id: str, job_id: str, attempt: int) -> Entry:
    """Return the amount held for this attempt (as recorded on the hold) to available credits.
    Raises LedgerConflict if the attempt has no hold or it was captured."""
    return _settle(conn, user_id, job_id, attempt, "release", "capture")


# ---- reads -------------------------------------------------------------------------------


def _read_wallet(conn: Connection, user_id: str) -> WalletBalance:
    row = conn.execute(
        select(_wallets.c.balance_credits, _wallets.c.reserved_credits).where(
            _wallets.c.user_id == user_id
        )
    ).first()
    balance, reserved = (row.balance_credits, row.reserved_credits) if row else (0, 0)
    return WalletBalance(balance, reserved, balance - reserved)


def get_wallet(conn_or_engine: Connection | Engine, user_id: str) -> WalletBalance:
    """Balance, reserved and available; all 0 for a user who has no wallet row yet."""
    if isinstance(conn_or_engine, Engine):
        with conn_or_engine.connect() as conn:
            return _read_wallet(conn, user_id)
    return _read_wallet(conn_or_engine, user_id)


def _job_charged(conn: Connection, job_id: str) -> int:
    taken = conn.execute(
        select(func.coalesce(func.sum(_entries.c.credits), 0)).where(
            _entries.c.ref_type == JOB,
            or_(
                _entries.c.ref_id == job_id,
                _entries.c.ref_id.startswith(f"{job_id}#", autoescape=True),
            ),
        )
    ).scalar_one()
    return -int(taken)


def job_charged_credits(conn_or_engine: Connection | Engine, job_id: str) -> int:
    """Credits actually taken from the wallet for a job: the voice charge (less any return)
    plus every captured hold of every approval attempt (D-038, D-039). Holds and releases move
    only reserved credits, so they add nothing. 0 for a job with no entries."""
    if isinstance(conn_or_engine, Engine):
        with conn_or_engine.connect() as conn:
            return _job_charged(conn, job_id)
    return _job_charged(conn_or_engine, job_id)


def list_entries(
    engine: Engine, user_id: str, page: int = 1, page_size: int = 20
) -> tuple[list[Entry], int]:
    """One page (1-based) of the user's entries, newest first, and the user's total count."""
    if page < 1 or page_size < 1:
        raise ValueError("page and page_size must be at least 1")
    with engine.connect() as conn:
        total = conn.execute(
            select(func.count()).select_from(_entries).where(_entries.c.user_id == user_id)
        ).scalar_one()
        rows = conn.execute(
            select(_entries)
            .where(_entries.c.user_id == user_id)
            .order_by(_entries.c.created_at.desc(), _entries.c.id.desc())
            .limit(page_size)
            .offset((page - 1) * page_size)
        ).all()
    return [_entry(r) for r in rows], total


def invariant_holds(conn: Connection, user_id: str) -> bool:
    """The stored balance equals the sum of `credits` and the stored reserved equals the sum of
    `reserved_delta` over the user's entries (D-004)."""
    sums = conn.execute(
        select(
            func.coalesce(func.sum(_entries.c.credits), 0),
            func.coalesce(func.sum(_entries.c.reserved_delta), 0),
        ).where(_entries.c.user_id == user_id)
    ).one()
    wallet = _read_wallet(conn, user_id)
    return (wallet.balance_credits, wallet.reserved_credits) == (sums[0], sums[1])


# ---- convenience for callers outside a job transaction ------------------------------------


class WalletStore:
    """Each method runs one operation in its own `engine.begin()` transaction. For the grant
    command and tests; job code calls the functions above inside its own transaction."""

    def __init__(self, engine: Engine):
        self.engine = engine

    def grant(self, user_id: str, credits: int, ref_id: str, created_by: str | None) -> Entry:
        with self.engine.begin() as conn:
            return grant(conn, user_id, credits, ref_id, created_by)

    def voice_charge(self, user_id: str, job_id: str, credits: int) -> Entry:
        with self.engine.begin() as conn:
            return voice_charge(conn, user_id, job_id, credits)

    def voice_return(self, user_id: str, job_id: str) -> Entry:
        with self.engine.begin() as conn:
            return voice_return(conn, user_id, job_id)

    def hold(self, user_id: str, job_id: str, credits: int, attempt: int) -> Entry:
        with self.engine.begin() as conn:
            return hold(conn, user_id, job_id, credits, attempt)

    def capture(self, user_id: str, job_id: str, attempt: int) -> Entry:
        with self.engine.begin() as conn:
            return capture(conn, user_id, job_id, attempt)

    def release(self, user_id: str, job_id: str, attempt: int) -> Entry:
        with self.engine.begin() as conn:
            return release(conn, user_id, job_id, attempt)

    def job_charged_credits(self, job_id: str) -> int:
        return job_charged_credits(self.engine, job_id)

    def get_wallet(self, user_id: str) -> WalletBalance:
        return get_wallet(self.engine, user_id)

    def list_entries(
        self, user_id: str, page: int = 1, page_size: int = 20
    ) -> tuple[list[Entry], int]:
        return list_entries(self.engine, user_id, page, page_size)

    def invariant_holds(self, user_id: str) -> bool:
        with self.engine.connect() as conn:
            return invariant_holds(conn, user_id)
