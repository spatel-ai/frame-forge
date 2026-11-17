"""T-305: concurrency and invariant tests for the wallet and charging (M3 exit evidence).

Many threads, each on its own database connection and transaction, hit ONE wallet at the same
moment (a `threading.Barrier` releases them together). After every scenario an invariant checker
runs: `ledger.invariant_holds` and an independent SQL check written here. Requirements: R-04 (a
balance that never goes negative and equals its ledger) and R-10 (each charge happens once, tied
to its job).

Engines here are built with a pool at least as large as the thread count, so every thread holds
a real connection at the barrier and the wallet row lock, not the pool, is what serialises them.

Mock provider only; free; no network."""

import asyncio
import threading
from collections.abc import Callable
from dataclasses import replace
from io import BytesIO

import pytest
from PIL import Image
from sqlalchemy import Engine, create_engine, text

from app.core.config import Settings
from app.jobs import db
from app.jobs.db import JobStore
from app.jobs.service import Conflict, JobService, NotEnoughCredits
from app.providers import MockProvider
from app.wallet import ledger
from app.wallet.ledger import InsufficientCredits, LedgerConflict
from tests.conftest import CONSENT_VERSION

VOICE = 10  # Settings.voice_price_credits (D-038)
# The mock speaks 15 characters a second: 32 characters is 2.133… s, priced ceil(42.67) = 43.
SCRIPT = "Hello there, this is a test run."
PRICE = 43
JOIN_TIMEOUT = 30


# ---- harness -----------------------------------------------------------------------------


def big_engine(url: str, size: int) -> Engine:
    """An engine whose pool can give every thread its own connection at once."""
    return create_engine(url, pool_size=size, max_overflow=5, pool_timeout=20)


def run_together(n: int, work: Callable[[int], object]) -> list[object]:
    """Run `work(i)` for i in 0..n-1 on n threads that start together (barrier). Returns each
    result or the exception it raised, by index. A thread that never finishes (lock wait or
    deadlock) fails the test instead of hanging the suite."""
    barrier = threading.Barrier(n, timeout=20)
    results: list[object] = [None] * n

    def target(i: int) -> None:
        try:
            barrier.wait()
            results[i] = work(i)
        except BaseException as exc:  # inspected in the main thread
            results[i] = exc

    threads = [threading.Thread(target=target, args=(i,), daemon=True) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=JOIN_TIMEOUT)
        assert not t.is_alive(), "a thread never finished: lock wait or deadlock"
    for r in results:
        if isinstance(r, threading.BrokenBarrierError):
            raise r
    return results


def unexpected(results: list[object], *allowed: type[BaseException]) -> None:
    """Re-raise the first exception that is not one of the documented outcomes."""
    for r in results:
        if isinstance(r, BaseException) and not isinstance(r, allowed):
            raise r


def in_tx(engine: Engine, op: Callable[..., ledger.Entry], *args: object) -> ledger.Entry:
    """One ledger operation in its own connection and transaction."""
    with engine.begin() as conn:
        return op(conn, *args)


def check_invariants(engine: Engine) -> None:
    """Scenario 6, run after every scenario, for EVERY user in the schema:

    - `ledger.invariant_holds` (the app's own check);
    - independently in SQL: balance == sum(credits) and reserved == sum(reserved_delta), and no
      user has entries without a wallet row;
    - available >= 0 and reserved >= 0 on every wallet, and on every entry's after-values (each
      entry records the wallet as committed by its transaction, so this covers every committed
      point, not just the end);
    - each hold reference has at most one capture or release, and every capture or release has
      a hold of the same amount for the same user."""
    with engine.connect() as conn:
        users = conn.execute(
            text("SELECT user_id FROM wallets UNION SELECT user_id FROM ledger_entries")
        ).scalars()
        for user_id in users:
            assert ledger.invariant_holds(conn, user_id), f"ledger.invariant_holds: {user_id}"

        mismatched = conn.execute(
            text(
                "SELECT s.user_id, w.balance_credits, w.reserved_credits, s.c, s.r "
                "FROM (SELECT user_id, sum(credits) AS c, sum(reserved_delta) AS r "
                "      FROM ledger_entries GROUP BY user_id) s "
                "LEFT JOIN wallets w ON w.user_id = s.user_id "
                "WHERE w.user_id IS NULL OR w.balance_credits <> s.c "
                "   OR w.reserved_credits <> s.r"
            )
        ).all()
        assert mismatched == [], f"wallet differs from its ledger: {mismatched}"
        empty_but_nonzero = conn.execute(
            text(
                "SELECT user_id FROM wallets w WHERE (w.balance_credits <> 0 "
                "OR w.reserved_credits <> 0) AND NOT EXISTS "
                "(SELECT 1 FROM ledger_entries e WHERE e.user_id = w.user_id)"
            )
        ).all()
        assert empty_but_nonzero == [], f"wallet with money but no entries: {empty_but_nonzero}"

        negative = conn.execute(
            text(
                "SELECT user_id FROM wallets "
                "WHERE reserved_credits < 0 OR balance_credits < reserved_credits"
            )
        ).all()
        assert negative == [], f"wallet with negative available or reserved: {negative}"
        negative_points = conn.execute(
            text(
                "SELECT id, kind, ref_id, balance_after, reserved_after FROM ledger_entries "
                "WHERE reserved_after < 0 OR balance_after < reserved_after"
            )
        ).all()
        assert negative_points == [], f"a committed point went negative: {negative_points}"

        double_settled = conn.execute(
            text(
                "SELECT ref_id, count(*) FROM ledger_entries "
                "WHERE ref_type = 'job' AND kind IN ('capture', 'release') "
                "GROUP BY ref_id HAVING count(*) > 1"
            )
        ).all()
        assert double_settled == [], f"a hold settled more than once: {double_settled}"
        doubled = conn.execute(
            text(
                "SELECT kind, ref_type, ref_id, count(*) FROM ledger_entries "
                "GROUP BY kind, ref_type, ref_id HAVING count(*) > 1"
            )
        ).all()
        assert doubled == [], f"a reference written twice: {doubled}"
        orphan_settlements = conn.execute(
            text(
                "SELECT s.kind, s.ref_id FROM ledger_entries s "
                "LEFT JOIN ledger_entries h ON h.kind = 'hold' AND h.ref_type = 'job' "
                "  AND h.ref_id = s.ref_id AND h.user_id = s.user_id "
                "WHERE s.kind IN ('capture', 'release') "
                "  AND (h.id IS NULL OR s.reserved_delta <> -h.reserved_delta "
                "       OR (s.kind = 'capture' AND s.credits <> -h.reserved_delta) "
                "       OR (s.kind = 'release' AND s.credits <> 0))"
            )
        ).all()
        assert orphan_settlements == [], f"settlement without a matching hold: {orphan_settlements}"


def count(engine: Engine, sql: str, **params: object) -> int:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar_one()


def wallet(engine: Engine, user_id: str) -> tuple[int, int]:
    w = ledger.get_wallet(engine, user_id)
    return w.balance_credits, w.reserved_credits


@pytest.fixture
def engine(database_url):
    eng = big_engine(database_url, 60)
    yield eng
    eng.dispose()


@pytest.fixture
def user(database_url, seed_user):
    return seed_user(database_url, "owner@example.com")


# ---- ledger-level scenarios --------------------------------------------------------------


def test_many_holds_on_limited_credits_never_overspend(engine, user):
    """R-04, R-10 (scenario 1): 1,000 credits; 50 threads each hold 43 for a distinct job at the
    same moment. Exactly floor(1000/43) = 23 succeed, the other 27 get InsufficientCredits, one
    hold row per success, reserved never exceeds balance, and the invariants hold."""
    in_tx(engine, ledger.grant, user, 1000, "g1", None)
    n = 50

    def work(i: int) -> str:
        with engine.begin() as conn:
            ledger.hold(conn, user, f"job{i}", PRICE, 1)
        return "ok"

    results = run_together(n, work)
    unexpected(results, InsufficientCredits)
    ok = results.count("ok")
    refused = [r for r in results if isinstance(r, InsufficientCredits)]
    assert ok == 1000 // PRICE == 23
    assert len(refused) == n - ok == 27
    assert all(r.required == PRICE and r.available < PRICE for r in refused)
    assert count(engine, "SELECT count(*) FROM ledger_entries WHERE kind = 'hold'") == ok
    assert wallet(engine, user) == (1000, ok * PRICE)
    check_invariants(engine)


def test_mixed_grants_holds_captures_releases_match_the_ledger(engine, database_url, seed_user):
    """R-04, R-10 (scenario 2): a user with NO wallet row yet (so the row's creation races too).
    At once: 10 grants of 50 (distinct refs), and 30 jobs each hold 43 then capture (even) or
    release (odd), all in one thread per job. Holds may be refused while credits are short; the
    final balance and reserved equal what each thread recorded and what the ledger sums say, and
    available is never negative at any committed point (checked on every entry's after-values)."""
    user = seed_user(database_url, "mixed@example.com")
    grants, jobs = 10, 30

    def work(i: int) -> tuple[str, str]:
        if i < grants:
            in_tx(engine, ledger.grant, user, 50, f"g{i}", None)
            return ("grant", "ok")
        j = i - grants
        try:
            in_tx(engine, ledger.hold, user, f"job{j}", PRICE, 1)
        except InsufficientCredits:
            return ("hold", "refused")
        settle = ledger.capture if j % 2 == 0 else ledger.release
        in_tx(engine, settle, user, f"job{j}", 1)
        return ("capture" if j % 2 == 0 else "release", "ok")

    results = run_together(grants + jobs, work)
    unexpected(results)
    assert results[:grants] == [("grant", "ok")] * grants
    captured = sum(1 for r in results if r == ("capture", "ok"))
    released = sum(1 for r in results if r == ("release", "ok"))
    refused = sum(1 for r in results if r == ("hold", "refused"))
    assert captured + released + refused == jobs
    # 500 granted, at most floor(500/43) = 11 captures can ever be paid for.
    assert captured <= 500 // PRICE
    assert wallet(engine, user) == (500 - captured * PRICE, 0)
    assert count(engine, "SELECT count(*) FROM ledger_entries WHERE kind = 'hold'") == (
        captured + released
    )
    assert count(engine, "SELECT count(*) FROM ledger_entries WHERE kind = 'grant'") == grants
    check_invariants(engine)


def test_same_reference_from_many_threads_is_written_once(engine, user):
    """R-10, R-04 (scenario 4, repeat + race): the same operation sent by 20 threads at once
    writes ONE entry and the repeats return that entry (documented no-op): same grant ref, same
    hold, same capture, same release, same voice charge, same voice return. Capture racing
    release on one hold (different kinds, so UNIQUE does not cover the pair; only the wallet
    lock does): exactly one settles, every caller of the other kind gets LedgerConflict."""
    n = 20

    def same(op: Callable[..., ledger.Entry], *args: object) -> ledger.Entry:
        results = run_together(n, lambda _i: in_tx(engine, op, *args))
        unexpected(results)
        ids = {r.id for r in results}  # type: ignore[union-attr]
        assert len(ids) == 1, f"{op.__name__} wrote {len(ids)} entries"
        return results[0]  # type: ignore[return-value]

    same(ledger.grant, user, 1000, "g1", None)
    same(ledger.hold, user, "jobA", PRICE, 1)
    same(ledger.capture, user, "jobA", 1)
    same(ledger.hold, user, "jobB", PRICE, 1)
    same(ledger.release, user, "jobB", 1)
    same(ledger.voice_charge, user, "jobC", VOICE)
    same(ledger.voice_return, user, "jobC")

    # Capture vs release of one hold, half the threads each.
    in_tx(engine, ledger.hold, user, "jobD", PRICE, 1)
    ops = [ledger.capture if i % 2 == 0 else ledger.release for i in range(n)]
    results = run_together(n, lambda i: (ops[i].__name__, in_tx(engine, ops[i], user, "jobD", 1)))
    unexpected(results, LedgerConflict)
    won = {r[0] for r in results if isinstance(r, tuple)}  # type: ignore[index]
    assert len(won) == 1, f"both capture and release succeeded: {won}"
    winner = won.pop()
    winners = [r for r in results if isinstance(r, tuple)]
    assert len(winners) == n // 2 and len({r[1].id for r in winners}) == 1  # type: ignore[index]
    assert sum(isinstance(r, LedgerConflict) for r in results) == n // 2
    # A repeat hold after settlement is refused, never a second hold row.
    results = run_together(n, lambda _i: in_tx(engine, ledger.hold, user, "jobD", PRICE, 1))
    assert all(isinstance(r, LedgerConflict) for r in results)

    # grant, hold+capture A, hold+release B, voice charge+return C, hold+one settlement D.
    assert count(engine, "SELECT count(*) FROM ledger_entries") == 9
    taken = PRICE + (PRICE if winner == "capture" else 0)
    assert wallet(engine, user) == (1000 - taken, 0)
    check_invariants(engine)


# ---- service-level scenarios (JobService, mock provider) ---------------------------------


@pytest.fixture
def settings(tmp_path, database_url) -> Settings:
    return replace(Settings(), provider="mock", data_dir=tmp_path, database_url=database_url)


@pytest.fixture
def service(settings):
    """A JobService whose store has a pool large enough for every thread, and whose background
    tasks are never started: worker threads have no event loop, and these tests are about the
    synchronous charging steps. Each test drives voices to `audio_ready` itself."""
    store = JobStore(settings.database_url)
    store.engine.dispose()
    store.engine = big_engine(settings.database_url, 40)
    svc = JobService(settings, store, MockProvider(settings))
    yield svc
    store.close()


def png() -> bytes:
    out = BytesIO()
    Image.new("RGB", (512, 512), "teal").save(out, "PNG")
    return out.getvalue()


def no_background(svc: JobService) -> list[str]:
    """Close every coroutine the service would spawn; return their names."""
    spawned: list[str] = []

    def close(coro) -> None:
        spawned.append(coro.__name__)
        coro.close()

    svc._spawn = close  # type: ignore[method-assign]
    return spawned


def test_concurrent_approvals_of_many_jobs_hold_only_what_is_affordable(service, user, grant):
    """R-04, R-10 (scenario 3): 20 ready jobs of one user, credits for only 7 videos; 20
    approvals through `JobService.approve_audio` at once. Exactly 7 jobs move to
    video_submitting with one hold each (attempt 1); the other 13 get NotEnoughCredits (never
    Conflict) and stay audio_ready, attempt 0, with no hold. No overspend; invariants hold."""
    n, affordable = 20, 7
    grant(service.store.engine, user, n * VOICE + affordable * PRICE + PRICE - 1)

    async def ready_jobs() -> list[str]:
        ids = [
            service.create_job(user, png(), SCRIPT, "English", CONSENT_VERSION)["id"]
            for _ in range(n)
        ]
        while service._tasks:
            await asyncio.gather(*list(service._tasks), return_exceptions=True)
        return ids

    job_ids = asyncio.run(ready_jobs())
    assert all(service.store.get(j)["status"] == db.AUDIO_READY for j in job_ids)  # type: ignore[index]
    assert wallet(service.store.engine, user) == (affordable * PRICE + PRICE - 1, 0)

    spawned = no_background(service)
    results = run_together(n, lambda i: service.approve_audio(user, job_ids[i])["status"])
    unexpected(results, NotEnoughCredits)
    assert not any(isinstance(r, Conflict) for r in results)
    assert results.count(db.VIDEO_SUBMITTING) == affordable
    assert sum(isinstance(r, NotEnoughCredits) for r in results) == n - affordable
    assert spawned == ["_submit_video"] * affordable

    engine = service.store.engine
    for job_id, r in zip(job_ids, results, strict=True):
        job = service.store.get(job_id)
        holds = count(
            engine,
            "SELECT count(*) FROM ledger_entries WHERE kind = 'hold' AND ref_id LIKE :r",
            r=f"{job_id}#%",
        )
        if r == db.VIDEO_SUBMITTING:
            assert (job["status"], job["approve_attempt"], holds) == (  # type: ignore[index]
                db.VIDEO_SUBMITTING,
                1,
                1,
            )
        else:
            assert (job["status"], job["approve_attempt"], holds) == (db.AUDIO_READY, 0, 0)  # type: ignore[index]
    assert wallet(engine, user) == (affordable * PRICE + PRICE - 1, affordable * PRICE)
    check_invariants(engine)


def test_concurrent_job_creation_charges_only_affordable_voices(service, user, grant, settings):
    """R-04, R-10 (scenario 5): credits for exactly 6 voices (plus 9 spare); 20 `create_job`
    calls at once. Exactly 6 jobs exist, each with one voice charge; the 14 refused get
    NotEnoughCredits and leave no job row and no folder (the folders on disk are exactly the
    created jobs). No overspend; invariants hold."""
    n, affordable = 20, 6
    grant(service.store.engine, user, affordable * VOICE + VOICE - 1)
    spawned = no_background(service)
    image = png()

    results = run_together(
        n, lambda _i: service.create_job(user, image, SCRIPT, "English", CONSENT_VERSION)
    )
    unexpected(results, NotEnoughCredits)
    created = [r["id"] for r in results if isinstance(r, dict)]
    assert len(created) == affordable
    assert sum(isinstance(r, NotEnoughCredits) for r in results) == n - affordable
    assert spawned == ["_generate_audio"] * affordable

    engine = service.store.engine
    assert count(engine, "SELECT count(*) FROM jobs") == affordable
    with engine.connect() as conn:
        job_rows = set(conn.execute(text("SELECT id FROM jobs")).scalars())
        charged = set(
            conn.execute(
                text("SELECT ref_id FROM ledger_entries WHERE kind = 'voice_charge'")
            ).scalars()
        )
    assert job_rows == set(created) == charged
    folders = {p.name for p in settings.jobs_dir.iterdir()} if settings.jobs_dir.exists() else set()
    assert folders == set(created)
    assert wallet(engine, user) == (VOICE - 1, 0)
    check_invariants(engine)
