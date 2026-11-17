"""Wallet routes, mounted under /api/v1/wallet: the M3 contract (task T-300).

Both need a session (401 `not_authenticated`) and only ever show the caller's own wallet.

Charging errors live on the job routes: 402 `insufficient_credits` on POST /jobs (fewer than the
voice price available) and on approve (fewer than the video price available). The 402 `detail`
states the amounts, so the browser never computes money (frontend rule 1)."""

from datetime import timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import Engine

from ..auth.deps import CurrentUser, current_user
from ..core.errors import ErrorOut
from . import ledger
from .schemas import LedgerEntryOut, TransactionsOut, WalletOut

router = APIRouter(prefix="/api/v1/wallet", tags=["wallet"])

User = Annotated[CurrentUser, Depends(current_user)]

_E = {"model": ErrorOut}
_AUTH: dict[int | str, dict[str, Any]] = {401: _E}


def _engine(request: Request) -> Engine:
    return request.app.state.service.store.engine


def _entry_out(e: ledger.Entry) -> LedgerEntryOut:
    # Same text format as the jobs API's created_at (app.jobs.db.now_iso): UTC, whole seconds.
    created = e.created_at.astimezone(timezone.utc).isoformat(timespec="seconds")
    return LedgerEntryOut(
        id=e.id,
        kind=e.kind,  # type: ignore[arg-type]  # str from the DB; the CHECK keeps it in the set
        credits=e.credits,
        reserved_delta=e.reserved_delta,
        balance_after=e.balance_after,
        reserved_after=e.reserved_after,
        job_id=e.job_id,
        created_at=created,
    )


@router.get("", response_model=WalletOut, responses=_AUTH, summary="The caller's balance")
def get_wallet(request: Request, user: User) -> WalletOut:
    w = ledger.get_wallet(_engine(request), user.id)
    return WalletOut(
        balance_credits=w.balance_credits,
        reserved_credits=w.reserved_credits,
        available_credits=w.available_credits,
    )


@router.get(
    "/transactions",
    response_model=TransactionsOut,
    responses={**_AUTH, 422: _E},
    summary="The caller's ledger, newest first",
)
def list_transactions(
    request: Request,
    user: User,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> TransactionsOut:
    entries, total = ledger.list_entries(_engine(request), user.id, page, page_size)
    return TransactionsOut(
        items=[_entry_out(e) for e in entries], total=total, page=page, page_size=page_size
    )
