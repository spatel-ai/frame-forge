"""Frameforge API: wiring only (app, lifespan, routers, errors, middleware)."""

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from .auth import routes as auth_routes
from .auth.email import EmailSender, build_email_sender
from .auth.service import AuthService
from .auth.store import AuthStore
from .core import health
from .core.config import Settings
from .core.database import DatabaseNotReady, check_database
from .core.errors import register_error_handlers
from .core.logging import RequestIdMiddleware, configure_logging
from .jobs import routes as job_routes
from .jobs.db import JobStore
from .jobs.errors import register_job_error_handlers
from .jobs.service import JobService
from .providers import Provider, build_provider

configure_logging()


def create_app(
    settings: Settings | None = None,
    provider: Provider | None = None,
    start_poller: bool = True,
    email_sender: EmailSender | None = None,
) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Fail before touching the database if production has no way to send email.
        sender = email_sender or build_email_sender(settings)
        store = JobStore(settings.database_url)
        try:
            check_database(store.engine)
        except DatabaseNotReady:
            store.close()
            raise
        service = JobService(settings, store, provider or build_provider(settings))
        service.recover_interrupted()
        app.state.service = service
        app.state.auth_service = AuthService(settings, AuthStore(store.engine), sender)
        poller = asyncio.create_task(service.run_poller()) if start_poller else None
        try:
            yield
        finally:
            if poller:
                poller.cancel()
                with suppress(asyncio.CancelledError):
                    await poller
            store.close()

    app = FastAPI(title="Frameforge API", lifespan=lifespan)
    app.state.settings = settings
    register_error_handlers(app)
    register_job_error_handlers(app)
    app.add_middleware(RequestIdMiddleware)
    app.include_router(auth_routes.router)
    app.include_router(job_routes.router)
    app.include_router(health.router)
    return app
