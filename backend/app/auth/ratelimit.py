"""In-memory sliding-window rate limits (D-035, task T-205).

Counters live in this process only: they reset on restart and are wrong with more than one
process (revisit with D-009). One `RateLimiter` is built per app (see `AuthService`).

Every attempt is stored as a timestamp, and only timestamps inside the window count, so the
limit is exact at window edges (no fixed-window burst of double the limit). Expired entries are
dropped on access and by a periodic sweep, so memory stays bounded by recent traffic."""

import math
import threading
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from ..core.errors import error_response

MINUTE = 60.0
HOUR = 3600.0
_SWEEP_EVERY = 256  # operations between full sweeps of idle keys
_MAX_KEY_CHARS = 300  # a submitted email is never stored longer than this


@dataclass(frozen=True)
class Rule:
    key: str
    limit: int
    window: float  # seconds


class RateLimited(Exception):
    def __init__(self, retry_after: int):
        super().__init__("rate limited")
        self.retry_after = retry_after


def client_address(request: Request) -> str:
    """The TCP peer address. X-Forwarded-For is deliberately NOT read: there is no trusted proxy
    yet, so any client could forge it and dodge the limits. In development every request comes
    through the Vite proxy and shares 127.0.0.1, which is acceptable. Revisit when a proxy is
    added at launch."""
    return request.client.host if request.client else "unknown"


def key_part(value: str) -> str:
    return value.strip().lower()[:_MAX_KEY_CHARS]


class RateLimiter:
    def __init__(self, clock: Callable[[], float]):
        self._clock = clock
        self._lock = threading.Lock()
        self._hits: dict[str, tuple[deque[float], float]] = {}  # key -> (times, window)
        self._ops = 0

    def _prune(self, key: str, window: float, now: float) -> deque[float]:
        entry = self._hits.get(key)
        if entry is None:
            return deque()
        times = entry[0]
        while times and times[0] <= now - window:
            times.popleft()
        if not times:
            del self._hits[key]
        return times

    def _sweep(self, now: float) -> None:
        self._ops += 1
        if self._ops % _SWEEP_EVERY:
            return
        for key, (times, window) in list(self._hits.items()):
            if not times or times[-1] <= now - window:
                del self._hits[key]

    @staticmethod
    def _wait(times: deque[float], window: float, now: float) -> int:
        return max(1, math.ceil(times[0] + window - now))

    def _append(self, rule: Rule, now: float) -> None:
        self._hits.setdefault(rule.key, (deque(), rule.window))[0].append(now)

    def blocked(self, rule: Rule) -> int | None:
        """Seconds to wait if the rule's limit is reached, else None. Records nothing."""
        with self._lock:
            now = self._clock()
            self._sweep(now)
            times = self._prune(rule.key, rule.window, now)
            return self._wait(times, rule.window, now) if len(times) >= rule.limit else None

    def record(self, rule: Rule) -> None:
        with self._lock:
            now = self._clock()
            self._prune(rule.key, rule.window, now)
            self._append(rule, now)

    def hit(self, *rules: Rule) -> int | None:
        """Count one attempt against every rule, unless any rule is already full. Returns the
        seconds to wait (the longest) when refused; a refused attempt is not counted, so the
        wait never grows. All rules are decided under one lock."""
        with self._lock:
            now = self._clock()
            self._sweep(now)
            waits = []
            for rule in rules:
                times = self._prune(rule.key, rule.window, now)
                if len(times) >= rule.limit:
                    waits.append(self._wait(times, rule.window, now))
            if waits:
                return max(waits)
            for rule in rules:
                self._append(rule, now)
            return None

    def clear(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def size(self) -> int:
        with self._lock:
            return len(self._hits)


def _rate_limited(_: Request, exc: RateLimited) -> JSONResponse:
    minutes = max(1, math.ceil(exc.retry_after / 60))
    unit = "minute" if minutes == 1 else "minutes"
    return error_response(
        429,
        f"Too many attempts. Please wait {minutes} {unit} and try again.",
        "rate_limited",
        headers={"Retry-After": str(exc.retry_after)},
    )


def register_rate_limit_handler(app: FastAPI) -> None:
    app.add_exception_handler(RateLimited, _rate_limited)  # type: ignore[arg-type]
