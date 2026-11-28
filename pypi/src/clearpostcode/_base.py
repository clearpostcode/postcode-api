"""What the sync and async clients share: results, pages, rate limits, building a request and reading its answer."""

from __future__ import annotations

import email.utils
import json
import os
import platform
import random
import re
import time
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field, replace
from typing import Any, Generic, TypeVar
from urllib.parse import quote

import httpx

from ._errors import APIError, error_for
from ._generated import OPERATIONS
from ._version import __version__

DataT = TypeVar("DataT")
MetaT = TypeVar("MetaT")
ItemT = TypeVar("ItemT")

BULK_POSTCODES = 100
BULK_POINTS = 20
_RETRY_STATUS = frozenset({408, 429, 500, 502, 503, 504})
#: A POST (a bulk call) is retried only on answers that say nothing was billed: never after a timeout or a dropped
#: connection, when the API may have answered and billed it.
_RETRY_POST = frozenset({429, 503})


@dataclass(frozen=True, slots=True)
class RateLimit:
    """The limit closest to running out, from the RateLimit headers."""

    #: Which limit: "month" (a keyed call's lookups), "day" (keyless), "burst" or "minute".
    policy: str | None
    limit: int | None
    remaining: int | None
    #: Seconds until it resets.
    reset: int | None


@dataclass(frozen=True, slots=True)
class Result(Generic[DataT, MetaT]):
    """One answer: ``data`` and ``meta`` as the API sent them, with the call's id and rate-limit state."""

    data: DataT
    meta: MetaT
    status: int
    #: Quote it to support and the call can be traced.
    request_id: str | None
    rate_limit: RateLimit | None


@dataclass(frozen=True, slots=True)
class Page(Result[list[ItemT], MetaT]):
    """One page of a list. ``next()`` fetches the page after it (None after the last)."""

    #: meta.next_cursor: pass it as ``cursor`` for the next page; None on the last page.
    next_cursor: str | None = None
    _next: Callable[[str], Page[ItemT, MetaT]] | None = field(default=None, repr=False, compare=False)

    @property
    def has_more(self) -> bool:
        return self.next_cursor is not None

    def next(self) -> Page[ItemT, MetaT] | None:
        return self._next(self.next_cursor) if self._next and self.next_cursor else None


@dataclass(frozen=True, slots=True)
class AsyncPage(Result[list[ItemT], MetaT]):
    """One page of a list. ``await next()`` fetches the page after it (None after the last)."""

    next_cursor: str | None = None
    _next: Callable[[str], Awaitable[AsyncPage[ItemT, MetaT]]] | None = field(default=None, repr=False, compare=False)

    @property
    def has_more(self) -> bool:
        return self.next_cursor is not None

    async def next(self) -> AsyncPage[ItemT, MetaT] | None:
        return await self._next(self.next_cursor) if self._next and self.next_cursor else None


@dataclass(frozen=True, slots=True)
class BulkResult(Generic[ItemT]):
    """A bulk call's answer, sent in chunks the API takes (100 postcodes, 20 points) and joined in the order sent."""

    data: list[ItemT]
    #: The last chunk's meta, with ``sent`` and ``found`` added up over every chunk. None for an empty list.
    meta: dict[str, Any] | None
    #: One id per chunk.
    request_ids: list[str | None]
    rate_limit: RateLimit | None


@dataclass(frozen=True, slots=True)
class Call(Generic[DataT, MetaT]):
    """One operation's call: path parameters, query parameters (only those the operation takes) and a JSON body. The
    type parameters carry the answer's types to the client."""

    op: str
    path: Mapping[str, str] = field(default_factory=dict)
    query: Mapping[str, str | int | float | None] = field(default_factory=dict)
    body: Any = None
    #: For a paged call: the query parameter the cursor goes back in.
    cursor_param: str | None = None

    def at(self, cursor: str) -> Call[DataT, MetaT]:
        assert self.cursor_param
        return replace(self, query={**self.query, self.cursor_param: cursor})


@dataclass(frozen=True, slots=True)
class Config:
    key: str | None
    base_url: str
    timeout: float
    max_retries: int
    max_retry_delay: float


def config(key: str | None, base_url: str, timeout: float, max_retries: int, max_retry_delay: float) -> Config:
    """The client's settings. The key comes from ``key``, else CLEAR_POSTCODE_KEY; "" or neither means keyless."""
    k = os.environ.get("CLEAR_POSTCODE_KEY") if key is None else key
    return Config(k or None, base_url.rstrip("/"), timeout, max_retries, max_retry_delay)


def user_agent() -> str:
    return f"clearpostcode-python/{__version__} python/{platform.python_version()} httpx/{httpx.__version__}"


def build(cfg: Config, call: Call[Any, Any]) -> httpx.Request:
    """The request for a call: path parameters encoded into the path, then the query the operation takes."""
    method, path, allowed = OPERATIONS[call.op]

    def segment(m: re.Match[str]) -> str:
        v = str(call.path.get(m[1], "")).strip()
        if not v:
            raise TypeError(f"{call.op} needs a {m[1]}")
        return quote(v, safe="")

    url = cfg.base_url + re.sub(r"\{(\w+)\}", segment, path)
    params: dict[str, str] = {}
    for k, v in call.query.items():
        if v is None:
            continue
        if k not in allowed:
            raise TypeError(f'{call.op} takes no "{k}" parameter (it takes: {", ".join(allowed) or "none"})')
        params[k] = str(v)
    headers = {"accept": "application/json", "user-agent": user_agent()}
    if cfg.key:
        headers["x-api-key"] = cfg.key
    extensions = {"timeout": httpx.Timeout(cfg.timeout).as_dict()}
    if call.body is None:
        return httpx.Request(method, url, params=params, headers=headers, extensions=extensions)
    return httpx.Request(method, url, params=params, headers=headers, json=call.body, extensions=extensions)


def _int(v: str | None) -> int | None:
    return int(v) if v is not None and v.isdigit() else None


def rate_limit_of(h: httpx.Headers) -> RateLimit | None:
    """RateLimit-Limit/-Remaining/-Reset, with the policy name and gaps filled from RateLimit and RateLimit-Policy."""
    m = re.match(r'^\s*"([^"]+)"\s*;(.*)$', h.get("ratelimit", ""))
    policy = m[1] if m else None

    def item(s: str | None, k: str) -> str | None:
        f = re.search(rf"(?:^|;)\s*{k}=(\d+)", s or "")
        return f[1] if f else None

    q = next(
        (p for p in h.get("ratelimit-policy", "").split(",") if policy and p.strip().startswith(f'"{policy}"')), None
    )
    r = RateLimit(
        policy=policy,
        limit=_int(h.get("ratelimit-limit")) if h.get("ratelimit-limit") else _int(item(q, "q")),
        remaining=_int(h.get("ratelimit-remaining"))
        if h.get("ratelimit-remaining")
        else _int(item(m[2] if m else None, "r")),
        reset=_int(h.get("ratelimit-reset")) if h.get("ratelimit-reset") else _int(item(m[2] if m else None, "t")),
    )
    return None if r == RateLimit(None, None, None, None) else r


def retry_after_of(h: httpx.Headers) -> float | None:
    """Seconds from a Retry-After header: delta-seconds or an HTTP date."""
    v = h.get("retry-after")
    if v is None:
        return None
    try:
        return max(0.0, float(v))
    except ValueError:
        pass
    try:
        at = email.utils.parsedate_to_datetime(v)
    except (TypeError, ValueError):
        return None
    return max(0.0, at.timestamp() - time.time())


def backoff(attempt: int) -> float:
    """Exponential backoff with jitter: about 0.5 s, 1 s, 2 s… up to 8 s."""
    return float(min(8.0, 0.5 * 2**attempt) * (0.5 + random.random() / 2))


def answer(response: httpx.Response, call: Call[DataT, MetaT]) -> Result[DataT, MetaT] | APIError:
    """The result of a 2xx answer, or the error for any other."""
    if response.is_success:
        try:
            body = response.json()
        except ValueError:
            return APIError(response.status_code, {"detail": "The answer was not JSON."}, response.headers, None)
        return Result(
            body["data"],
            body["meta"],
            response.status_code,
            response.headers.get("x-request-id"),
            rate_limit_of(response.headers),
        )
    try:
        problem = response.json()
    except (ValueError, json.JSONDecodeError):
        problem = None
    return error_for(
        response.status_code,
        problem if isinstance(problem, dict) else None,
        response.headers,
        retry_after_of(response.headers),
    )


def retry_wait(cfg: Config, call: Call[Any, Any], error: APIError, attempt: int) -> float | None:
    """Seconds to wait before retrying an error answer, or None to raise it now. No wait is longer than
    max_retry_delay: a longer Retry-After is raised at once."""
    retryable = _RETRY_POST if OPERATIONS[call.op][0] == "POST" else _RETRY_STATUS
    if error.status not in retryable or attempt >= cfg.max_retries:
        return None
    advised = error.retry_after
    if advised is None and error.status == 429:
        limit = rate_limit_of(error.headers)
        advised = float(limit.reset) if limit and limit.remaining == 0 and limit.reset is not None else None
    if advised is not None and advised > cfg.max_retry_delay:
        return None
    return advised if advised is not None else min(backoff(attempt), cfg.max_retry_delay)


def connection_wait(cfg: Config, call: Call[Any, Any], attempt: int) -> float | None:
    """Seconds to wait before retrying after a timeout or a dropped connection (never a POST), or None to raise."""
    if OPERATIONS[call.op][0] == "POST" or attempt >= cfg.max_retries:
        return None
    return min(backoff(attempt), cfg.max_retry_delay)


def chunks(items: Iterable[ItemT], size: int) -> list[list[ItemT]]:
    seq = list(items)
    return [seq[i : i + size] for i in range(0, len(seq), size)]


def _found(item: Any) -> bool:
    """Did an item find anything: a bulk lookup's record, a bulk reverse point's postcodes."""
    result = item.get("result") if isinstance(item, dict) else None
    return bool(result) if isinstance(result, list) else result is not None


def joined(results: list[Result[list[ItemT], Any]]) -> BulkResult[ItemT]:
    """Bulk chunks joined in order, sent and found added up."""
    data = [x for r in results for x in r.data]
    meta: dict[str, Any] | None = None
    if results:
        meta = {
            **results[-1].meta,
            "sent": sum(r.meta.get("sent", len(r.data)) for r in results),
            "found": sum(r.meta.get("found", sum(map(_found, r.data))) for r in results),
        }
    return BulkResult(data, meta, [r.request_id for r in results], results[-1].rate_limit if results else None)
