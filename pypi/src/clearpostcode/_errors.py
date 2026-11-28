"""Every error the client raises."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast

import httpx

from ._generated import ProblemCode

if TYPE_CHECKING:
    from ._base import BulkResult


class ClearPostcodeError(Exception):
    """The base of every error the client raises."""

    #: Set when a bulk call fails part-way: the chunks already answered (and billed), so nothing is lost.
    partial: BulkResult[Any] | None = None


class APIError(ClearPostcodeError):
    """The API answered with an error: an RFC 9457 problem.

    ``code`` is the problem type (``"postcode_not_found"``), ``request_id`` the id to quote to support, and
    ``retry_after`` the seconds the API asked you to wait (429 and 503), when it said.
    """

    def __init__(self, status: int, problem: dict[str, Any] | None, headers: httpx.Headers, retry_after: float | None):
        p = problem or {}
        kind = p.get("type")
        self.status = status
        #: The problem type. New codes may appear, so match the ones you handle and let the rest through.
        self.code: ProblemCode | str | None = (
            cast(ProblemCode, kind.rsplit("#", 1)[1]) if isinstance(kind, str) and "#" in kind else None
        )
        self.title: str | None = p.get("title")
        self.detail: str | None = p.get("detail")
        self.request_id: str | None = p.get("request_id") or headers.get("x-request-id")
        self.retry_after = retry_after
        #: The problem body as the API sent it (extra members such as ``parameters``, ``resets`` or ``upgrade``).
        self.problem: dict[str, Any] = p
        self.headers = headers
        code = f" {self.code}" if self.code else ""
        rid = f" (request {self.request_id})" if self.request_id else ""
        super().__init__(f"{status}{code}: {self.detail or self.title or 'the API answered with an error'}{rid}")


class BadRequestError(APIError):
    """400 or 413: a parameter, the postcode format or the body (invalid_postcode, unknown_parameter, bad_request…)."""


class AuthenticationError(APIError):
    """401: the key is missing where one is needed, malformed or not active (invalid_key, key_required)."""


class QuotaExceededError(APIError):
    """402: the period's lookups, or the address credits, are used up (quota_exceeded, address_credits_exhausted)."""


class PermissionDeniedError(APIError):
    """403: the key may not make this call (publishable_key_not_allowed, address_lookup_not_enabled…)."""


class NotFoundError(APIError):
    """404: no such postcode, district or address (postcode_not_found, not_covered, not_found)."""


class UnprocessableEntityError(APIError):
    """422: a real postcode with no coordinates (no_position: the Channel Islands and the Isle of Man)."""


class RateLimitError(APIError):
    """429: too many requests, a day's keyless allowance, or the key's daily cap (rate_limited, daily_cap_reached)."""


class InternalServerError(APIError):
    """5xx: a moment's trouble on the API's side (server_error, service_unavailable). Retried for you."""


class APIConnectionError(ClearPostcodeError):
    """The API could not be reached (DNS, TLS, a dropped connection). Retried for you."""


class APITimeoutError(APIConnectionError):
    """No answer within the timeout. Retried for you."""


_BY_STATUS: dict[int, type[APIError]] = {
    400: BadRequestError,
    401: AuthenticationError,
    402: QuotaExceededError,
    403: PermissionDeniedError,
    404: NotFoundError,
    413: BadRequestError,
    422: UnprocessableEntityError,
    429: RateLimitError,
}


def error_for(
    status: int, problem: dict[str, Any] | None, headers: httpx.Headers, retry_after: float | None
) -> APIError:
    """The error class for an HTTP status."""
    cls = _BY_STATUS.get(status) or (InternalServerError if status >= 500 else APIError)
    return cls(status, problem, headers, retry_after)
