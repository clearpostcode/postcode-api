"""The async client: the same calls, awaited, against a mocked API."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from clearpostcode import AsyncClearPostcode, AsyncPage, InternalServerError, NotFoundError, RateLimitError, _base

Handler = Callable[[httpx.Request], httpx.Response]
META = {"edition": "2026-08"}


def ok(data: Any, **meta: Any) -> httpx.Response:
    return httpx.Response(200, json={"data": data, "meta": {**META, **meta}}, headers={"x-request-id": "req-200"})


def problem(status: int, code: str, headers: dict[str, str] | None = None) -> httpx.Response:
    body = {"type": f"https://clearpostcode.co.uk/developers/docs/errors#{code}", "title": code, "status": status}
    return httpx.Response(
        status, json={**body, "detail": "d", "instance": "/v1/x", "request_id": "rid"}, headers=headers
    )


def client(handler: Handler, **options: Any) -> tuple[AsyncClearPostcode, list[httpx.Request]]:
    calls: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    return AsyncClearPostcode(
        "", http_client=httpx.AsyncClient(transport=httpx.MockTransport(record)), **options
    ), calls


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_base, "backoff", lambda attempt: 0.0)
    monkeypatch.delenv("CLEAR_POSTCODE_KEY", raising=False)


async def test_lookup_and_typed_errors() -> None:
    cp, calls = client(lambda r: ok({"postcode": "SW1A 1AA", "status": "live"}))
    r = await cp.postcodes.lookup("SW1A 1AA", fields=["ward"])
    assert r.data["postcode"] == "SW1A 1AA" and r.request_id == "req-200"
    assert calls[0].url.raw_path == b"/v1/postcodes/SW1A%201AA?fields=ward"
    nf, _ = client(lambda r: problem(404, "postcode_not_found"))
    with pytest.raises(NotFoundError) as caught:
        await nf.postcodes.lookup("SW1A 9ZZ")
    assert caught.value.code == "postcode_not_found"


async def test_retries_honour_retry_after_and_give_up_after_max_retries() -> None:
    answers = iter([problem(503, "service_unavailable", {"retry-after": "0"}), ok({"valid": True})])
    cp, calls = client(lambda r: next(answers))
    assert dict((await cp.postcodes.validate("M1 1AE")).data) == {"valid": True}
    assert len(calls) == 2
    capped, capped_calls = client(lambda r: problem(429, "daily_cap_reached", {"retry-after": "40000"}))
    with pytest.raises(RateLimitError):
        await capped.postcodes.validate("M1 1AE")
    assert len(capped_calls) == 1
    down, down_calls = client(lambda r: problem(500, "server_error"), max_retries=2)
    with pytest.raises(InternalServerError):
        await down.postcodes.validate("M1 1AE")
    assert len(down_calls) == 3


async def test_pages_and_the_async_iterator() -> None:
    pages = {None: ([{"postcode": "A"}], "c1"), "c1": ([{"postcode": "B"}], None)}

    def answer(r: httpx.Request) -> httpx.Response:
        data, nxt = pages[r.url.params.get("cursor")]
        return ok(data, next_cursor=nxt)

    cp, calls = client(answer)
    first = await cp.outcodes.postcodes("SW1A")
    assert isinstance(first, AsyncPage) and first.has_more
    second = await first.next()
    assert second is not None and await second.next() is None
    assert [p["postcode"] async for p in cp.outcodes.all_postcodes("SW1A")] == ["A", "B"]
    assert [a["postcode"] async for a in cp.addresses.all_by_postcode("AB10 1AA")] == ["A", "B"]
    assert calls[-1].url.params == httpx.QueryParams({"postcode": "AB10 1AA", "cursor": "c1"})


async def test_bulk_chunks_at_100() -> None:
    def answer(r: httpx.Request) -> httpx.Response:
        sent = json.loads(r.content)["postcodes"]
        return ok([{"query": q, "result": None} for q in sent], sent=len(sent), found=0)

    cp, calls = client(answer)
    r = await cp.postcodes.bulk([f"PC{i}" for i in range(201)])
    assert len(calls) == 3 and len(r.data) == 201 and r.meta is not None and r.meta["sent"] == 201


async def test_the_async_context_manager_closes_its_own_connections() -> None:
    async with AsyncClearPostcode() as cp:
        own = cp._http
    assert own.is_closed
