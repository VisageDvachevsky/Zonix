from __future__ import annotations

from collections import defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass
from time import monotonic

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


def client_ip_from_scope(scope: Scope) -> str:
    client = scope.get("client")
    if not client:
        return "unknown"
    host, _port = client
    return str(host)


class RequestTooLargeError(RuntimeError):
    pass


class RequestBodyLimitMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        max_body_bytes: int,
        methods: tuple[str, ...] = ("POST", "PUT", "PATCH", "DELETE"),
    ) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes
        self.methods = frozenset(method.upper() for method in methods)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method", "").upper() not in self.methods:
            await self.app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        content_length = headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > self.max_body_bytes:
                    await self._send_limit_exceeded(send)
                    return
            except ValueError:
                await self._send_limit_exceeded(send)
                return

        bytes_seen = 0

        async def limited_receive() -> Message:
            nonlocal bytes_seen
            message = await receive()
            if message["type"] != "http.request":
                return message

            body = message.get("body", b"")
            bytes_seen += len(body)
            if bytes_seen > self.max_body_bytes:
                raise RequestTooLargeError()
            return message

        try:
            await self.app(scope, limited_receive, send)
        except RequestTooLargeError:
            await self._send_limit_exceeded(send)

    async def _send_limit_exceeded(self, send: Send) -> None:
        response = JSONResponse(
            status_code=413,
            content={"detail": "request body exceeds configured size limit"},
        )
        await send(
            {
                "type": "http.response.start",
                "status": response.status_code,
                "headers": response.raw_headers,
            }
        )
        await send(
            {
                "type": "http.response.body",
                "body": response.body,
                "more_body": False,
            }
        )


class SecurityHeadersMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        permissions_policy: str,
    ) -> None:
        self.app = app
        self.permissions_policy = permissions_policy

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend(
                    [
                        (b"x-content-type-options", b"nosniff"),
                        (b"x-frame-options", b"DENY"),
                        (b"referrer-policy", b"no-referrer"),
                        (
                            b"permissions-policy",
                            self.permissions_policy.encode("latin-1"),
                        ),
                        (b"cache-control", b"no-store"),
                    ]
                )
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


@dataclass(frozen=True)
class LoginRateLimitDecision:
    allowed: bool
    retry_after_seconds: int = 0


class LoginRateLimiter:
    def __init__(
        self,
        *,
        max_attempts: int,
        window_seconds: int,
        now: Callable[[], float] | None = None,
    ) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._now = now or monotonic

    def check(self, key: str) -> LoginRateLimitDecision:
        attempts = self._attempts[key]
        self._prune(attempts)
        if len(attempts) >= self.max_attempts:
            retry_after = max(1, int(self.window_seconds - (self._now() - attempts[0])))
            return LoginRateLimitDecision(allowed=False, retry_after_seconds=retry_after)
        return LoginRateLimitDecision(allowed=True)

    def record_failure(self, key: str) -> None:
        attempts = self._attempts[key]
        self._prune(attempts)
        attempts.append(self._now())

    def reset(self, key: str) -> None:
        self._attempts.pop(key, None)

    def _prune(self, attempts: deque[float]) -> None:
        cutoff = self._now() - self.window_seconds
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()
