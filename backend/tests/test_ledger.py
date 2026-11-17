"""T-301, T-302: the wallet tables and the ledger service.

Runs against the Docker database in a throwaway schema (conftest). No money moves for real; no
network. Each test names the requirement it covers: R-04 (a balance that never goes negative and
equals its ledger) and R-10 (each charge happens once, tied to the job)."""

import threading
import time

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from app.wallet import ledger
from app.wallet.ledger import InsufficientCredits, LedgerConflict, WalletStore


@pytest.fixture
def engine(database_url):
    eng = create_engine(database_url)
    yield eng
    eng.dispose()


@pytest.fixture
def store(engine):
    return WalletStore(engine)


@pytest.fixture
def user(database_url, seed_user):
    return seed_user(database_url, "owner@example.com")


def entry_count(engine, user_id):
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT count(*) FROM ledger_entries WHERE user_id = :u"), {"u": user_id}
        ).scalar_one()


def balances(store, user_id):
    w = store.get_wallet(user_id)
    return w.balance_credits, w.reserved_credits, w.available_credits


# ---- the database itself (T-301) ---------------------------------------------------------


def test_database_rejects_negative_available(engine, store, user):
    """R-04: a direct UPDATE that makes reserved exceed balance, or reserved negative, fails on
    the CHECK constraint."""
    store.grant(user, 100, "g1", None)
    for sql in (
        "UPDATE wallets SET reserved_credits = 101 WHERE user_id = :u",
        "UPDATE wallets SET balance_credits = -1, reserved_credits = -5 WHERE user_id = :u",
        "UPDATE wallets SET reserved_credits = -1 WHERE user_id = :u",
    ):
        with pytest.raises(IntegrityError, match="ck_wallets_available_not_negative"):
            with engine.begin() as conn:
                conn.execute(text(sql), {"u": user})
    assert balances(store, user) == (100, 0, 100)


def test_database_rejects_duplicate_reference(engine, store, user):
    """R-04, R-10: a direct INSERT of a second entry with the same (kind, ref_type, ref_id) fails
    on the UNIQUE constraint."""
    store.grant(user, 50, "g1", None)
    insert = text(
        "INSERT INTO ledger_entries (id, user_id, kind, credits, reserved_delta, balance_after, "
        "reserved_after, ref_type, ref_id, created_at) "
        "VALUES (:id, :u, 'grant', 50, 0, 100, 0, 'grant', 'g1', now())"
    )
    with pytest.raises(IntegrityError, match="uq_ledger_entries_kind_ref"):
        with engine.begin() as conn:
            conn.execute(insert, {"id": "dup", "u": user})
    assert entry_count(engine, user) == 1


def test_database_rejects_unknown_kind(engine, user):
    """R-04: the kind CHECK refuses a kind outside LedgerKind."""
    with pytest.raises(IntegrityError, match="ck_ledger_entries_kind"):
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO ledger_entries (id, user_id, kind, credits, reserved_delta, "
                    "balance_after, reserved_after, ref_type, ref_id, created_at) "
                    "VALUES ('x', :u, 'gift', 5, 0, 5, 0, 'grant', 'x', now())"
                ),
                {"u": user},
            )


# ---- each operation's effect (T-302) -----------------------------------------------------


def test_new_user_has_an_empty_wallet(store, user):
    """R-04: a user without a wallet row reads as 0, 0, 0."""
    assert balances(store, user) == (0, 0, 0)
    assert store.list_entries(user) == ([], 0)


def test_grant(store, user):
    """R-04: grant adds to the balance and records the after-values and who granted."""
    e = store.grant(user, 500, "g1", "dev@example.com")
    assert (e.kind, e.credits, e.reserved_delta) == ("grant", 500, 0)
    assert (e.balance_after, e.reserved_after) == (500, 0)
    assert (e.ref_type, e.ref_id, e.created_by, e.job_id) == (
        "grant",
        "g1",
        "dev@example.com",
        None,
    )
    assert balances(store, user) == (500, 0, 500)


def test_voice_charge_and_return(store, user):
    """R-10: voice_charge takes from the balance; voice_return gives back the charged amount."""
    store.grant(user, 100, "g1", None)
    c = store.voice_charge(user, "job1", 10)
    assert (c.kind, c.credits, c.reserved_delta, c.balance_after, c.reserved_after) == (
        "voice_charge",
        -10,
        0,
        90,
        0,
    )
    assert c.job_id == "job1"
    assert balances(store, user) == (90, 0, 90)
    r = store.voice_return(user, "job1")
    assert (r.kind, r.credits, r.reserved_delta, r.balance_after, r.reserved_after) == (
        "voice_return",
        10,
        0,
        100,
        0,
    )
    assert balances(store, user) == (100, 0, 100)


def test_hold_then_capture(store, user):
    """R-10: hold moves reserved only; capture takes the held amount from both."""
    store.grant(user, 1000, "g1", None)
    h = store.hold(user, "job1", 600, 1)
    assert (h.credits, h.reserved_delta, h.balance_after, h.reserved_after) == (0, 600, 1000, 600)
    assert balances(store, user) == (1000, 600, 400)
    c = store.capture(user, "job1", 1)
    assert (c.credits, c.reserved_delta, c.balance_after, c.reserved_after) == (-600, -600, 400, 0)
    assert balances(store, user) == (400, 0, 400)


def test_hold_then_release(store, user):
    """R-10: release returns the held amount to available; the balance never moved."""
    store.grant(user, 1000, "g1", None)
    store.hold(user, "job1", 600, 1)
    r = store.release(user, "job1", 1)
    assert (r.credits, r.reserved_delta, r.balance_after, r.reserved_after) == (0, -600, 1000, 0)
    assert balances(store, user) == (1000, 0, 1000)


def test_capture_uses_the_hold_amount(engine, store, user):
    """R-10: capture and release take no amount; they use the amount on the hold entry, even
    after the wallet has moved for other reasons."""
    import inspect

    params = ["conn", "user_id", "job_id", "attempt"]  # no amount; the attempt names the hold
    assert list(inspect.signature(ledger.capture).parameters) == params
    assert list(inspect.signature(ledger.release).parameters) == params
    store.grant(user, 1000, "g1", None)
    store.hold(user, "job1", 240, 1)
    store.hold(user, "job2", 300, 1)
    store.grant(user, 77, "g2", None)
    c = store.capture(user, "job1", 1)
    assert (c.credits, c.reserved_delta) == (-240, -240)
    assert balances(store, user) == (837, 300, 537)


# ---- repeat case: every operation twice ---------------------------------------------------


@pytest.mark.parametrize(
    "steps",
    [
        [("grant", (500, "g1", None))],
        [("grant", (500, "g0", None)), ("voice_charge", ("job1", 10))],
        [("grant", (500, "g0", None)), ("voice_charge", ("job1", 10)), ("voice_return", ("job1",))],
        [("grant", (500, "g0", None)), ("hold", ("job1", 200, 1))],
        [("grant", (500, "g0", None)), ("hold", ("job1", 200, 1)), ("capture", ("job1", 1))],
        [("grant", (500, "g0", None)), ("hold", ("job1", 200, 1)), ("release", ("job1", 1))],
    ],
    ids=["grant", "voice_charge", "voice_return", "hold", "capture", "release"],
)
def test_repeat_is_a_no_op(engine, store, user, steps):
    """R-10: the last operation called twice writes one entry, returns the same entry, and
    leaves the balances unchanged the second time."""
    for name, args in steps:
        first = getattr(store, name)(user, *args)
    before, count = balances(store, user), entry_count(engine, user)
    name, args = steps[-1]
    again = getattr(store, name)(user, *args)
    assert again == first
    assert balances(store, user) == before
    assert entry_count(engine, user) == count == len(steps)
    assert store.invariant_holds(user)


def test_repeat_with_another_amount_is_refused(store, user):
    """R-10: the same reference with a different amount is a caller bug, refused, not hidden."""
    store.grant(user, 500, "g1", None)
    store.hold(user, "job1", 200, 1)
    store.voice_charge(user, "job2", 10)
    with pytest.raises(LedgerConflict):
        store.grant(user, 600, "g1", None)
    with pytest.raises(LedgerConflict):
        store.hold(user, "job1", 201, 1)
    with pytest.raises(LedgerConflict):
        store.voice_charge(user, "job2", 11)
    assert balances(store, user) == (490, 200, 290)


def test_reference_of_another_user_is_refused(database_url, seed_user, engine, store, user):
    """R-10: a job reference already used by another user is a conflict, never that user's
    entry, and never touches either wallet."""
    other = seed_user(database_url, "other@example.com")
    store.grant(user, 500, "g1", None)
    store.grant(other, 500, "g2", None)
    store.hold(user, "job1", 100, 1)
    with pytest.raises(LedgerConflict):
        store.hold(other, "job1", 100, 1)
    with pytest.raises(LedgerConflict):
        store.capture(other, "job1", 1)
    with pytest.raises(LedgerConflict):
        store.grant(other, 500, "g1", None)
    assert balances(store, user) == (500, 100, 400)
    assert balances(store, other) == (500, 0, 500)


# ---- refusals -----------------------------------------------------------------------------


@pytest.mark.parametrize("op", ["voice_charge", "hold"])
def test_insufficient_credits_writes_nothing(engine, store, user, op):
    """R-04: voice_charge and hold refuse more than the available credits (balance − reserved),
    report required and available, and write nothing."""
    store.grant(user, 100, "g1", None)
    store.hold(user, "held", 70, 1)
    extra = (1,) if op == "hold" else ()  # a hold names its approval attempt (D-039)
    with pytest.raises(InsufficientCredits) as err:
        getattr(store, op)(user, "job1", 31, *extra)
    assert (err.value.required, err.value.available) == (31, 30)
    assert balances(store, user) == (100, 70, 30)
    assert entry_count(engine, user) == 2
    getattr(store, op)(user, "job1", 30, *extra)  # exactly the available amount is allowed
    assert balances(store, user)[2] == 0


def test_refusal_leaves_the_callers_transaction_usable(engine, user):
    """R-04, R-10: a refusal raises before any write, so the caller's transaction can carry on
    and commit its other work."""
    with engine.begin() as conn:
        ledger.grant(conn, user, 50, "g1", None)
        with pytest.raises(InsufficientCredits):
            ledger.hold(conn, user, "job1", 51, 1)
        with pytest.raises(LedgerConflict):
            ledger.capture(conn, user, "job1", 1)
        ledger.hold(conn, user, "job1", 50, 1)
    assert WalletStore(engine).get_wallet(user).available_credits == 0
    assert entry_count(engine, user) == 2


def test_capture_or_release_without_a_hold_is_refused(engine, store, user):
    """R-10: capture and release need a hold for that job."""
    store.grant(user, 100, "g1", None)
    for op in (store.capture, store.release):
        with pytest.raises(LedgerConflict):
            op(user, "job1", 1)
    assert entry_count(engine, user) == 1
    assert balances(store, user) == (100, 0, 100)


def test_capture_and_release_exclude_each_other(engine, store, user):
    """R-10: once a hold is captured it cannot be released, and the reverse."""
    store.grant(user, 1000, "g1", None)
    store.hold(user, "job1", 100, 1)
    store.capture(user, "job1", 1)
    with pytest.raises(LedgerConflict):
        store.release(user, "job1", 1)
    store.hold(user, "job2", 100, 1)
    store.release(user, "job2", 1)
    with pytest.raises(LedgerConflict):
        store.capture(user, "job2", 1)
    assert balances(store, user) == (900, 0, 900)
    assert entry_count(engine, user) == 5


def test_hold_again_after_settlement_is_refused(store, user):
    """R-10: a hold that was captured or released cannot be reused for the same approval
    attempt; returning the old entry would pretend credits are reserved. (A new approval uses a
    new attempt, D-039.)"""
    store.grant(user, 1000, "g1", None)
    store.hold(user, "job1", 100, 1)
    store.release(user, "job1", 1)
    with pytest.raises(LedgerConflict):
        store.hold(user, "job1", 100, 1)
    assert balances(store, user) == (1000, 0, 1000)


def test_voice_return_without_a_charge_is_refused(engine, store, user):
    """R-10: voice_return needs a voice_charge for that job."""
    store.grant(user, 100, "g1", None)
    with pytest.raises(LedgerConflict):
        store.voice_return(user, "job1")
    assert entry_count(engine, user) == 1


@pytest.mark.parametrize("bad", [10.0, "10", True, None, 2**0.5])
def test_amounts_must_be_ints(store, user, bad):
    """R-04: amounts are integers only (rule 6); a float, string, bool or None is a TypeError."""
    for call in (
        lambda: store.grant(user, bad, "g1", None),
        lambda: store.voice_charge(user, "job1", bad),
        lambda: store.hold(user, "job1", bad, 1),
    ):
        with pytest.raises(TypeError):
            call()


@pytest.mark.parametrize("bad", [0, -5])
def test_amounts_must_be_positive(engine, store, user, bad):
    """R-04: a zero or negative amount would mint credits or free a reservation; refused."""
    for call in (
        lambda: store.grant(user, bad, "g1", None),
        lambda: store.voice_charge(user, "job1", bad),
        lambda: store.hold(user, "job1", bad, 1),
    ):
        with pytest.raises(ValueError):
            call()
    assert entry_count(engine, user) == 0


def test_operation_needs_a_transaction(engine, user):
    """R-04: a connection outside a transaction is refused, so nothing is left uncommitted."""
    with engine.connect() as conn:
        with pytest.raises(RuntimeError):
            ledger.grant(conn, user, 5, "g1", None)


# ---- the caller's transaction ---------------------------------------------------------------


def test_failure_after_the_ledger_call_rolls_back_both(engine, store, user):
    """R-10: an error after the ledger call, before commit, rolls back the wallet and the entry
    together (HLD §5.2)."""
    store.grant(user, 100, "g1", None)

    class JobUpdateFailed(Exception):
        pass

    with pytest.raises(JobUpdateFailed):
        with engine.begin() as conn:
            ledger.hold(conn, user, "job1", 60, 1)
            assert ledger.get_wallet(conn, user).reserved_credits == 60
            raise JobUpdateFailed
    assert balances(store, user) == (100, 0, 100)
    assert entry_count(engine, user) == 1
    store.hold(user, "job1", 60, 1)  # the reference is still free
    assert balances(store, user) == (100, 60, 40)


# ---- reads and the invariant ---------------------------------------------------------------


def test_invariant_after_a_mixed_sequence(engine, store, user):
    """R-04: after grants, charges, returns, holds, captures and releases (including refusals and
    repeats), balance = sum of credits and reserved = sum of reserved_delta."""
    store.grant(user, 1000, "g1", None)
    store.voice_charge(user, "a", 10)
    store.voice_charge(user, "b", 10)
    store.voice_return(user, "b")
    store.hold(user, "a", 600, 1)
    store.hold(user, "c", 300, 1)
    with pytest.raises(InsufficientCredits):
        store.hold(user, "d", 200, 1)
    store.capture(user, "a", 1)
    store.capture(user, "a", 1)
    store.release(user, "c", 1)
    store.grant(user, 50, "g2", None)
    assert balances(store, user) == (440, 0, 440)
    assert store.invariant_holds(user)
    with engine.connect() as conn:
        sums = conn.execute(
            text("SELECT sum(credits), sum(reserved_delta) FROM ledger_entries WHERE user_id = :u"),
            {"u": user},
        ).one()
    assert tuple(sums) == (440, 0)

    with engine.begin() as conn:  # a tampered wallet row is detected
        conn.execute(
            text("UPDATE wallets SET balance_credits = 441 WHERE user_id = :u"), {"u": user}
        )
    assert not store.invariant_holds(user)


def test_list_entries_newest_first_and_paged(store, user):
    """R-04: entries come back newest first, paged, with the user's total."""
    for i in range(5):
        store.grant(user, i + 1, f"g{i}", None)
    items, total = store.list_entries(user, page=1, page_size=2)
    assert total == 5
    assert [e.ref_id for e in items] == ["g4", "g3"]
    items, _ = store.list_entries(user, page=3, page_size=2)
    assert [e.ref_id for e in items] == ["g0"]
    assert store.list_entries(user, page=4, page_size=2) == ([], 5)
    with pytest.raises(ValueError):
        store.list_entries(user, page=0)


def test_reads_are_per_user(database_url, seed_user, store, user):
    """R-04: one user's entries and balance never appear for another."""
    other = seed_user(database_url, "other@example.com")
    store.grant(user, 10, "g1", None)
    assert store.list_entries(other) == ([], 0)
    assert balances(store, other) == (0, 0, 0)


# ---- race case -------------------------------------------------------------------------------


def test_two_holds_at_once_only_one_succeeds(engine, store, user):
    """R-04, R-10: two threads hold at the same moment on a wallet that can afford only one.
    The wallet row lock serialises them: exactly one succeeds, the other gets
    InsufficientCredits, and the invariant holds. Each winner keeps its transaction open briefly
    so the other is certain to be waiting on the lock, not merely running later."""
    store.grant(user, 100, "g1", None)
    barrier = threading.Barrier(2, timeout=10)
    results: dict[str, object] = {}

    def attempt(job_id: str) -> None:
        conn = engine.connect()
        try:
            tx = conn.begin()
            barrier.wait()
            try:
                ledger.hold(conn, user, job_id, 60, 1)
                time.sleep(0.3)
                tx.commit()
                results[job_id] = "ok"
            except InsufficientCredits as exc:
                tx.rollback()
                results[job_id] = exc
        except BaseException as exc:  # surfaced in the main thread below
            results[job_id] = exc
        finally:
            conn.close()

    threads = [threading.Thread(target=attempt, args=(j,)) for j in ("job1", "job2")]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)
        assert not t.is_alive(), "a hold never finished: lock wait or deadlock"

    outcomes = list(results.values())
    unexpected = [o for o in outcomes if o != "ok" and not isinstance(o, InsufficientCredits)]
    if unexpected:
        raise unexpected[0]  # type: ignore[misc]
    assert outcomes.count("ok") == 1
    refused = [o for o in outcomes if isinstance(o, InsufficientCredits)]
    assert len(refused) == 1
    assert (refused[0].required, refused[0].available) == (60, 40)
    assert balances(store, user) == (100, 60, 40)
    assert store.invariant_holds(user)


def test_same_hold_twice_at_once_is_written_once(engine, store, user):
    """R-10: the same hold (same job) sent twice at the same moment, on a wallet that could
    afford both, writes one entry; the second caller waits on the lock, then gets that entry."""
    store.grant(user, 1000, "g1", None)
    barrier = threading.Barrier(2, timeout=10)
    results: list[object] = []

    def attempt() -> None:
        conn = engine.connect()
        try:
            tx = conn.begin()
            barrier.wait()
            entry = ledger.hold(conn, user, "job1", 100, 1)
            time.sleep(0.3)
            tx.commit()
            results.append(entry.id)
        except BaseException as exc:  # surfaced in the main thread below
            results.append(exc)
        finally:
            conn.close()

    threads = [threading.Thread(target=attempt) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)
        assert not t.is_alive(), "a hold never finished: lock wait or deadlock"
    for r in results:
        if isinstance(r, BaseException):
            raise r
    assert len(results) == 2 and results[0] == results[1]
    assert balances(store, user) == (1000, 100, 900)
    assert entry_count(engine, user) == 2
    assert store.invariant_holds(user)


# ---- approval attempts (D-039) and credits taken per job ---------------------------------


def test_each_attempt_has_its_own_hold_reference(engine, store, user):
    """R-10 (D-039): approve, clean failure (release), approve again (a new hold under the next
    attempt), capture. Each attempt has exactly one hold and one settlement, the references are
    `<job>#<n>`, and `Entry.job_id` gives back the bare job id."""
    store.grant(user, 1000, "g1", None)
    store.voice_charge(user, "job1", 10)
    h1 = store.hold(user, "job1", 300, 1)
    r1 = store.release(user, "job1", 1)
    h2 = store.hold(user, "job1", 300, 2)
    c2 = store.capture(user, "job1", 2)
    assert [e.ref_id for e in (h1, r1, h2, c2)] == ["job1#1", "job1#1", "job1#2", "job1#2"]
    assert {e.job_id for e in (h1, r1, h2, c2)} == {"job1"}
    assert balances(store, user) == (690, 0, 690)
    # Repeating any step of either attempt is a no-op that returns the same entry (rule 9).
    assert store.release(user, "job1", 1) == r1
    assert store.capture(user, "job1", 2) == c2
    # Attempt 1 was released: it can be neither captured nor held again.
    with pytest.raises(LedgerConflict):
        store.capture(user, "job1", 1)
    with pytest.raises(LedgerConflict):
        store.hold(user, "job1", 300, 1)
    assert entry_count(engine, user) == 6
    assert store.invariant_holds(user)


def test_voice_entries_keep_the_bare_job_reference(store, user):
    """R-10 (D-039): a job has one voice, so its charge and return use the job id itself."""
    store.grant(user, 100, "g1", None)
    assert store.voice_charge(user, "job1", 10).ref_id == "job1"
    assert store.voice_return(user, "job1").ref_id == "job1"


@pytest.mark.parametrize("bad", [0, -1, True, 1.0, "1", None])
def test_attempt_must_be_a_positive_int(engine, store, user, bad):
    """R-10 (D-039): the attempt is a whole number from 1; anything else is refused, unwritten."""
    store.grant(user, 1000, "g1", None)
    for call in (
        lambda: store.hold(user, "job1", 100, bad),
        lambda: store.capture(user, "job1", bad),
        lambda: store.release(user, "job1", bad),
    ):
        with pytest.raises((TypeError, ValueError)):
            call()
    assert entry_count(engine, user) == 1


def test_job_id_with_the_separator_is_refused(store, user):
    """R-10 (D-039): a job id containing '#' could alias another job's attempt; refused."""
    store.grant(user, 1000, "g1", None)
    with pytest.raises(ValueError):
        store.hold(user, "job1#2", 100, 1)


def test_job_charged_credits(database_url, seed_user, store, user):
    """R-10: credits taken for a job = voice charge − voice return + every captured hold, over
    all attempts. Holds and releases take nothing. Another job's entries, including a job whose
    id starts with this one's, are not counted."""
    other = seed_user(database_url, "other@example.com")
    store.grant(user, 5000, "g1", None)
    store.grant(other, 5000, "g2", None)
    assert store.job_charged_credits("job1") == 0
    store.voice_charge(user, "job1", 10)
    assert store.job_charged_credits("job1") == 10
    store.hold(user, "job1", 300, 1)
    assert store.job_charged_credits("job1") == 10
    store.release(user, "job1", 1)
    store.hold(user, "job1", 300, 2)
    store.capture(user, "job1", 2)
    assert store.job_charged_credits("job1") == 310
    store.voice_charge(user, "job10", 10)
    store.hold(user, "job10", 40, 1)
    store.capture(user, "job10", 1)
    store.voice_charge(other, "job2", 10)
    store.voice_return(other, "job2")
    assert store.job_charged_credits("job1") == 310
    assert store.job_charged_credits("job10") == 50
    assert store.job_charged_credits("job2") == 0
    with store.engine.begin() as conn:  # also inside a caller's transaction
        assert ledger.job_charged_credits(conn, "job1") == 310


# ---- purchase (T-403) --------------------------------------------------------------------


def test_purchase_credits_once_per_payment(engine, store, user):
    """R-02, R-04: `purchase` adds credits under ('payment', <payment id>); the same payment
    again returns the same entry and writes nothing; another amount for it is refused; a second
    payment is a second entry."""
    with engine.begin() as conn:
        first = ledger.purchase(conn, user, 1000, "pay_A")
    assert (first.kind, first.credits, first.reserved_delta) == ("purchase", 1000, 0)
    assert (first.ref_type, first.ref_id, first.created_by, first.job_id) == (
        "payment",
        "pay_A",
        None,
        None,
    )
    with engine.begin() as conn:
        assert ledger.purchase(conn, user, 1000, "pay_A") == first
    with pytest.raises(LedgerConflict), engine.begin() as conn:
        ledger.purchase(conn, user, 999, "pay_A")
    with engine.begin() as conn:
        ledger.purchase(conn, user, 2000, "pay_B")
    assert balances(store, user) == (3000, 0, 3000)
    assert entry_count(engine, user) == 2
    assert store.invariant_holds(user)


def test_purchase_needs_a_positive_int_and_a_transaction(engine, user):
    """R-04: purchase refuses a float, a bool, zero or a negative, and a connection outside a
    transaction; nothing is written."""
    for bad in (10.0, True, 0, -5):
        with pytest.raises((TypeError, ValueError)), engine.begin() as conn:
            ledger.purchase(conn, user, bad, "pay_X")  # type: ignore[arg-type]
    with engine.connect() as conn, pytest.raises(RuntimeError):
        ledger.purchase(conn, user, 1000, "pay_X")
    assert entry_count(engine, user) == 0
