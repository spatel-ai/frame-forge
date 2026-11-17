"""Frameforge API: wiring only (app, lifespan, routers, errors, middleware)."""

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from .auth import routes as auth_routes
from .auth.email import EmailSender, build_email_sender
from .auth.ratelimit import register_rate_limit_handler
from .auth.service import AuthService
from .auth.store import AuthStore
from .core import health
from .core.config import Settings
from .core.database import DatabaseNotReady, check_database
from .core.errors import register_error_handlers
from .core.logging import RequestIdMiddleware, configure_logging
from .core.origin import OriginMiddleware
from .jobs import routes as job_routes
from .jobs.db import JobStore
from .jobs.errors import register_job_error_handlers
from .jobs.service import JobService
from .payments import routes as payment_routes
from .payments.gateway import build_gateway
from .payments.service import PaymentService
from .providers import Provider, build_provider
from .scripts import routes as script_routes
from .templates import routes as template_routes
from .wallet import routes as wallet_routes

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
        payments = PaymentService(settings, store.engine, build_gateway(settings))
        app.state.payments = payments
        poller = asyncio.create_task(service.run_poller()) if start_poller else None
        # T-405: ask Razorpay about unpaid orders every 5 minutes, like the job poller.
        reconciler = asyncio.create_task(payments.run_reconciler()) if start_poller else None
        try:
            yield
        finally:
            for task in (poller, reconciler):
                if task:
                    task.cancel()
                    with suppress(asyncio.CancelledError):
                        await task
            payments.gateway.close()
            store.close()

    app = FastAPI(title="Frameforge API", lifespan=lifespan)
    app.state.settings = settings
    register_error_handlers(app)
    register_job_error_handlers(app)
    register_rate_limit_handler(app)
    app.add_middleware(OriginMiddleware, allowed_origins=settings.allowed_origins)
    app.add_middleware(RequestIdMiddleware)
    app.include_router(auth_routes.router)
    app.include_router(job_routes.router)
    app.include_router(wallet_routes.router)
    app.include_router(script_routes.router)
    app.include_router(template_routes.router)
    app.include_router(payment_routes.router)
    app.include_router(payment_routes.webhook_router)
    # D-042: the stand-in for Razorpay Checkout exists only in mock mode during development.
    if settings.payments == "mock" and settings.environment == "development":
        app.include_router(payment_routes.mock_router)
    app.include_router(health.router)
    return app
