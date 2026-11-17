"""Wallet routes, mounted under /api/v1/wallet: the M3 contract (task T-300).

Both handlers are stubs that answer 501 `not_implemented` until T-306 builds them. Both need a
session (401 `not_authenticated`) and only ever show the caller's own wallet.

Charging errors live on the job routes: 402 `insufficient_credits` on POST /jobs (fewer than the
voice price available) and on approve (fewer than the video price available). The 402 `detail`
states the amounts, so the browser never computes money (frontend rule 1)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from ..auth.deps import CurrentUser, current_user
from ..core.errors import ApiError, ErrorOut
from .schemas import TransactionsOut, WalletOut

router = APIRouter(prefix="/api/v1/wallet", tags=["wallet"])

User = Annotated[CurrentUser, Depends(current_user)]

_E = {"model": ErrorOut}
_AUTH: dict[int | str, dict[str, Any]] = {401: _E}


def _not_built() -> ApiError:
    return ApiError(501, "This is not built yet.", "not_implemented")


@router.get("", response_model=WalletOut, responses=_AUTH, summary="The caller's balance")
def get_wallet(user: User) -> WalletOut:
    raise _not_built()


@router.get(
    "/transactions",
    response_model=TransactionsOut,
    responses={**_AUTH, 422: _E},
    summary="The caller's ledger, newest first",
)
def list_transactions(
    user: User,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> TransactionsOut:
    raise _not_built()
