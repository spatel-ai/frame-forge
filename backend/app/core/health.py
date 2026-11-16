"""Liveness plus database check, served at /healthz (outside /api/v1)."""

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from .errors import ApiError, ErrorOut

router = APIRouter()


class HealthOut(BaseModel):
    status: str


@router.get("/healthz", response_model=HealthOut, responses={503: {"model": ErrorOut}})
def healthz(request: Request) -> HealthOut:
    engine = request.app.state.service.store.engine
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise ApiError(503, "The database is not available.", "database_unavailable") from None
    return HealthOut(status="ok")
