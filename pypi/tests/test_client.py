"""The sync client against a mocked API that answers with the OpenAPI document's own examples."""

from __future__ import annotations

import json
import tomllib
from collections.abc import Callable
from functools import partial
from pathlib import Path
from typing import Any

import httpx
import pytest

import clearpostcode
from clearpostcode import (
    OPERATIONS,
    APIConnectionError,
    APIError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    ClearPostcode,
    ClearPostcodeError,
    InternalServerError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
    Result,
    _base,
)
from clearpostcode._base import Call, Config, rate_limit_of

ROOT = Path(__file__).resolve().parents[2]
DOC = json.loads((ROOT / "openapi/openapi.json").read_text())
EXAMPLES: dict[str, Any] = {
    op["operationId"]: op["responses"]["200"]["content"]["application/json"].get("example")
    for methods in DOC["paths"].values()
    for op in methods.values()
}
META = EXAMPLES["getPostcode"]["meta"]
Handler = Callable[[httpx.Request], httpx.Response]


def ok(data: Any, **meta: Any) -> httpx.Response:
    return httpx.Response(200, json={"data": data, "meta": {**META, **meta}}, headers={"x-request-id": "req-200"})


def problem(status: int, code: str, headers: dict[str, str] | None = None, **extra: Any) -> httpx.Response:
    body = {
        "type": f"https://clearpostcode.co.uk/developers/docs/errors#{code}",
        "title": code,
        "status": status,
        "detail": f"Detail for {code}.",
        "instance": "/v1/x",
        "request_id": f"rid-{code}",
        **extra,
    }
    return httpx.Response(status, json=body, headers=headers or {})


class Recorder:
    """An httpx transport that records each request and answers from a handler."""

    def __init__(self, handler: Handler) -> None:
        self.calls: list[httpx.Request] = []
        self.handler = handler

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        return self.handler(request)


def client(handler: Handler, key: str = "", **options: Any) -> tuple[ClearPostcode, Recorder]:
    rec = Recorder(handler)
    return ClearPostcode(key, http_client=httpx.Client(transport=httpx.MockTransport(rec)), **options), rec


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_base, "backoff", lambda attempt: 0.0)
    monkeypatch.delenv("CLEAR_POSTCODE_KEY", raising=False)


def test_every_operation_has_a_method_that_calls_it_and_answers_its_example() -> None:
    calls: dict[str, Callable[[ClearPostcode], Any]] = {
        "getPostcode": lambda cp: cp.postcodes.lookup("SW1A 1AA"),
        "validatePostcode": lambda cp: cp.postcodes.validate("sw1a1aa"),
        "nearestToPostcode": lambda cp: cp.postcodes.nearest("SW1A 1AA", limit=5),
        "reverseGeocode": lambda cp: cp.postcodes.reverse(51.501, -0.1416, limit=3),
        "bulkLookup": lambda cp: cp.postcodes.bulk(["SW1A 1AA", "SW1A 9ZZ"]),
        "bulkReverse": lambda cp: cp.postcodes.bulk_reverse([{"latitude": 51.5014, "longitude": -0.1419}]),
        "autocomplete": lambda cp: cp.postcodes.autocomplete("SW1A 1"),
        "distance": lambda cp: cp.postcodes.distance("SW1A 1AA", "EH1 1YZ"),
        "getOutcode": lambda cp: cp.outcodes.get("SW1A"),
        "outcodePostcodes": lambda cp: cp.outcodes.postcodes("SW1A", limit=100),
        "getSector": lambda cp: cp.sectors.get("SW1A 1"),
        "getArea": lambda cp: cp.areas.get("SW"),
        "places": lambda cp: cp.places.search("Chelsea"),
        "usage": lambda cp: cp.account.usage(),
        "addressesByPostcode": lambda cp: cp.addresses.by_postcode("AB10 1AA"),
        "addressSuggest": lambda cp: cp.addresses.suggest("2 high street porthmore"),
        "addressRetrieve": lambda cp: cp.addresses.retrieve("YR9BQjEwMUFBHzkwMDAwMDAxHw"),
        "addressByUdprn": lambda cp: cp.addresses.by_udprn("90000001"),
    }
    assert sorted(calls) == sorted(OPERATIONS)
    for op_id, call in calls.items():
        method, path, allowed = OPERATIONS[op_id]
        example = EXAMPLES[op_id] or {"data": [], "meta": META}  # the address routes carry no example yet
        cp, rec = client(partial(lambda e, r: httpx.Response(200, json=e), example))
        r = call(cp)
        assert len(rec.calls) == 1, op_id
        req = rec.calls[0]
        assert req.method == method, op_id
        segments = path.strip("/").split("/")
        sent = req.url.path.removeprefix("/v1/").split("/")
        assert len(sent) == len(segments) and all(
            s.startswith("{") or s == t for s, t in zip(segments, sent, strict=True)
        )
        assert set(req.url.params) <= set(allowed), op_id
        assert r.data == example["data"], op_id


def test_paths_are_trimmed_and_encoded_fields_joined_and_unset_options_left_out() -> None:
    cp, rec = client(lambda r: ok({"postcode": "SW1A 1AA", "status": "live"}))
    r = cp.postcodes.lookup(" SW1A 1AA ", fields=["location", "ward"])
    assert rec.calls[0].url.raw_path == b"/v1/postcodes/SW1A%201AA?fields=location%2Cward"
    assert r.data["postcode"] == "SW1A 1AA"
    cp.postcodes.nearest("SW1A 1AA")
    assert rec.calls[1].url.query == b""
    cp.postcodes.reverse(51.5, -0.12)
    assert rec.calls[2].url.params == httpx.QueryParams({"lat": "51.5", "lon": "-0.12"})


def test_a_parameter_the_operation_does_not_take_is_refused() -> None:
    cfg = Config(None, "https://x/v1", 1.0, 0, 0.0)
    with pytest.raises(TypeError, match='takes no "after" parameter'):
        _base.build(cfg, Call("outcodePostcodes", path={"outcode": "SW1A"}, query={"after": "SW1A1AA"}))
    assert str(_base.build(cfg, Call("outcodePostcodes", path={"outcode": "SW1A"}, query={"cursor": "c"})).url) == (
        "https://x/v1/outcodes/SW1A/postcodes?cursor=c"
    )


def test_keyless_sends_no_key_and_the_sdk_user_agent_and_reads_request_id_and_rate_limits() -> None:
    headers = {"x-request-id": "rid-1", "ratelimit": '"day";r=1990;t=3600', "ratelimit-policy": '"day";q=2000;w=86400'}
    cp, rec = client(lambda r: httpx.Response(200, json={"data": {}, "meta": META}, headers=headers))
    r = cp.postcodes.validate("M1 1AE")
    h = rec.calls[0].headers
    assert "x-api-key" not in h
    assert h["user-agent"].startswith(f"clearpostcode-python/{clearpostcode.__version__} python/")
    assert r.request_id == "rid-1" and r.status == 200
    assert r.rate_limit == clearpostcode.RateLimit("day", 2000, 1990, 3600)


def test_the_key_comes_from_the_argument_else_the_environment_and_empty_means_keyless(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key = "cp_live_" + "a" * 32
    rec = Recorder(lambda r: ok({}))
    http = httpx.Client(transport=httpx.MockTransport(rec))
    ClearPostcode(key, http_client=http).postcodes.validate("M1 1AE")
    assert rec.calls[0].headers["x-api-key"] == key
    assert "key" not in rec.calls[0].url.params
    monkeypatch.setenv("CLEAR_POSTCODE_KEY", key)
    ClearPostcode(http_client=http).postcodes.validate("M1 1AE")
    assert rec.calls[1].headers["x-api-key"] == key
    ClearPostcode("", http_client=http).postcodes.validate("M1 1AE")
    assert "x-api-key" not in rec.calls[2].headers
    monkeypatch.setenv("CLEAR_POSTCODE_KEY", "")
    ClearPostcode(http_client=http).postcodes.validate("M1 1AE")
    assert "x-api-key" not in rec.calls[3].headers


def test_errors_are_typed_and_carry_the_code_detail_and_request_id() -> None:
    cp, rec = client(lambda r: problem(404, "postcode_not_found", postcode="SW1A 9ZZ"))
    with pytest.raises(NotFoundError) as caught:
        cp.postcodes.lookup("SW1A 9ZZ")
    e = caught.value
    assert isinstance(e, ClearPostcodeError)
    assert (e.status, e.code, e.request_id, e.detail) == (
        404,
        "postcode_not_found",
        "rid-postcode_not_found",
        "Detail for postcode_not_found.",
    )
    assert e.problem["postcode"] == "SW1A 9ZZ"
    assert str(e) == "404 postcode_not_found: Detail for postcode_not_found. (request rid-postcode_not_found)"
    assert len(rec.calls) == 1
    cases: list[tuple[httpx.Response, type[APIError], str | None]] = [
        (problem(400, "unknown_parameter", parameters=["after"]), BadRequestError, "unknown_parameter"),
        (problem(401, "invalid_key"), AuthenticationError, "invalid_key"),
        (problem(403, "address_lookup_not_enabled"), PermissionDeniedError, "address_lookup_not_enabled"),
        (
            httpx.Response(502, text="<html>bad gateway</html>", headers={"x-request-id": "edge"}),
            InternalServerError,
            None,
        ),
    ]
    for response, cls, code in cases:
        c, _ = client(partial(lambda res, r: res, response), max_retries=0)
        with pytest.raises(cls) as err:
            c.postcodes.validate("M1 1AE")
        assert err.value.code == code


def test_503_and_429_honour_retry_after_then_succeed() -> None:
    answers = iter(
        [
            problem(503, "service_unavailable", {"retry-after": "0"}),
            problem(429, "rate_limited", {"retry-after": "0"}),
            ok({"valid": True}),
        ]
    )
    cp, rec = client(lambda r: next(answers))
    assert dict(cp.postcodes.validate("M1 1AE").data) == {"valid": True}
    assert len(rec.calls) == 3


def test_a_retry_after_past_max_retry_delay_is_raised_at_once() -> None:
    cp, rec = client(lambda r: problem(429, "daily_cap_reached", {"retry-after": "40000"}))
    with pytest.raises(RateLimitError) as caught:
        cp.postcodes.validate("M1 1AE")
    assert caught.value.retry_after == 40000
    assert len(rec.calls) == 1


def test_a_429_without_retry_after_waits_for_the_ratelimit_reset() -> None:
    answers = iter([problem(429, "rate_limited", {"ratelimit": '"burst";r=0;t=0'}), ok({})])
    cp, rec = client(lambda r: next(answers))
    cp.postcodes.validate("M1 1AE")
    assert len(rec.calls) == 2


def test_no_retry_for_4xx_none_with_max_retries_0_and_at_most_max_retries() -> None:
    a, rec_a = client(lambda r: problem(400, "invalid_postcode"))
    with pytest.raises(BadRequestError):
        a.postcodes.validate("x")
    assert len(rec_a.calls) == 1
    b, rec_b = client(lambda r: problem(503, "service_unavailable", {"retry-after": "0"}), max_retries=0)
    with pytest.raises(InternalServerError):
        b.postcodes.validate("M1 1AE")
    assert len(rec_b.calls) == 1
    c, rec_c = client(lambda r: problem(500, "server_error"), max_retries=3)
    with pytest.raises(InternalServerError):
        c.postcodes.validate("M1 1AE")
    assert len(rec_c.calls) == 4


def test_dropped_connections_and_timeouts_are_retried_then_raised() -> None:
    def drop(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    cp, rec = client(drop, max_retries=1)
    with pytest.raises(APIConnectionError) as caught:
        cp.postcodes.validate("M1 1AE")
    assert not isinstance(caught.value, APITimeoutError)
    assert isinstance(caught.value.__cause__, httpx.ConnectError)
    assert len(rec.calls) == 2

    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    t, _ = client(slow, max_retries=0, timeout=0.5)
    with pytest.raises(APITimeoutError, match=r"0\.5 s"):
        t.postcodes.validate("M1 1AE")


def test_the_timeout_reaches_httpx() -> None:
    cp, rec = client(lambda r: ok({}), timeout=3.5)
    cp.postcodes.validate("M1 1AE")
    assert rec.calls[0].extensions["timeout"]["read"] == 3.5
    cp.with_options(timeout=1.0).postcodes.validate("M1 1AE")
    assert rec.calls[1].extensions["timeout"]["read"] == 1.0


def test_rate_limits_read_from_the_three_fields_and_the_structured_headers() -> None:
    full = httpx.Headers(
        {
            "ratelimit": '"month";r=9588;t=1814400',
            "ratelimit-policy": '"burst";q=100;w=10, "month";q=10000;w=2592000',
            "ratelimit-limit": "10000",
            "ratelimit-remaining": "9588",
            "ratelimit-reset": "1814400",
        }
    )
    assert rate_limit_of(full) == clearpostcode.RateLimit("month", 10000, 9588, 1814400)
    structured = httpx.Headers(
        {"ratelimit": '"day";r=0;t=60', "ratelimit-policy": '"minute";q=30;w=60, "day";q=2000;w=86400'}
    )
    assert rate_limit_of(structured) == clearpostcode.RateLimit("day", 2000, 0, 60)
    assert rate_limit_of(httpx.Headers()) is None


def test_pages_follow_meta_next_cursor_and_the_iterator_walks_every_page_lazily() -> None:
    pages = {
        None: ([{"postcode": "SW1A 0AA"}, {"postcode": "SW1A 0PW"}], "c1"),
        "c1": ([{"postcode": "SW1A 1AA"}], "c2"),
        "c2": ([{"postcode": "SW1A 2AA"}], None),
    }

    def answer(r: httpx.Request) -> httpx.Response:
        data, nxt = pages[r.url.params.get("cursor")]
        return ok(data, total=4, next_cursor=nxt)

    cp, rec = client(answer)
    first = cp.outcodes.postcodes("SW1A", limit=2)
    assert first.next_cursor == "c1" and first.has_more
    second = first.next()
    assert second is not None
    assert rec.calls[1].url.params == httpx.QueryParams({"cursor": "c1", "limit": "2"})
    assert [dict(x) for x in second.data] == [{"postcode": "SW1A 1AA"}]
    it = cp.outcodes.all_postcodes("SW1A")
    assert len(rec.calls) == 2, "nothing is fetched until the iterator is read"
    assert [p["postcode"] for p in it] == ["SW1A 0AA", "SW1A 0PW", "SW1A 1AA", "SW1A 2AA"]
    third = second.next()
    assert third is not None and third.next() is None


def test_bulk_sends_100_a_call_and_joins_in_order() -> None:
    def answer(r: httpx.Request) -> httpx.Response:
        sent = json.loads(r.content)["postcodes"]
        return ok([{"query": q, "result": None, "error": "postcode_not_found"} for q in sent], sent=len(sent), found=0)

    cp, rec = client(answer, key="cp_live_" + "b" * 32)
    pcs = [f"PC{i}" for i in range(250)]
    r = cp.postcodes.bulk(pcs, fields=["ward"])
    assert [c.method for c in rec.calls] == ["POST"] * 3
    assert rec.calls[0].headers["content-type"] == "application/json"
    assert rec.calls[0].url.params["fields"] == "ward"
    assert [x["query"] for x in r.data] == pcs
    assert r.meta is not None and r.meta["sent"] == 250
    assert len(r.request_ids) == 3
    empty = cp.postcodes.bulk([])
    assert len(rec.calls) == 3 and empty.data == [] and empty.meta is None


def test_bulk_reverse_sends_20_points_a_call_as_lat_and_lon() -> None:
    sizes: list[int] = []

    def answer(r: httpx.Request) -> httpx.Response:
        points = json.loads(r.content)["points"]
        sizes.append(len(points))
        assert points[0]["lon"] == -0.1 and points[0]["limit"] == 1
        return ok([{"query": {"latitude": p["lat"], "longitude": p["lon"]}, "result": []} for p in points])

    cp, _ = client(answer)
    r = cp.postcodes.bulk_reverse([{"latitude": 51 + i / 100, "longitude": -0.1, "limit": 1} for i in range(45)])
    assert sizes == [20, 20, 5]
    assert r.data[44]["query"]["latitude"] == 51.44


def test_address_lookup_calls() -> None:
    def answer(r: httpx.Request) -> httpx.Response:
        if r.url.path == "/v1/addresses":
            return ok([{"udprn": "1"}], next_cursor=None if r.url.params.get("cursor") else "p2")
        return ok([])

    cp, rec = client(answer)
    cp.addresses.suggest("", container="c-123", limit=20)
    assert rec.calls[0].url.path == "/v1/addresses/suggest"
    assert rec.calls[0].url.params == httpx.QueryParams({"container": "c-123", "limit": "20"})
    cp.addresses.retrieve("YR9BQ/x")
    assert rec.calls[1].url.raw_path == b"/v1/addresses/retrieve/YR9BQ%2Fx"
    cp.addresses.by_udprn(90000001)
    assert rec.calls[2].url.path == "/v1/addresses/90000001"
    assert len(list(cp.addresses.all_by_postcode("AB10 1AA"))) == 2
    assert rec.calls[4].url.params == httpx.QueryParams({"postcode": "AB10 1AA", "cursor": "p2"})


def test_a_client_closes_its_own_connections_only() -> None:
    with ClearPostcode() as cp:
        own = cp._http
    assert own.is_closed
    shared = httpx.Client()
    with ClearPostcode(http_client=shared):
        pass
    assert not shared.is_closed
    shared.close()


def test_results_are_typed_dataclasses() -> None:
    cp, _ = client(lambda r: ok({"postcode": "M1 1AE", "status": "live"}))
    r = cp.postcodes.lookup("M1 1AE")
    assert isinstance(r, Result)
    with pytest.raises(AttributeError):
        r.data = {"postcode": "X", "status": "live"}  # type: ignore[misc]


def test_version_matches_pyproject() -> None:
    pyproject = tomllib.loads((ROOT / "pypi/pyproject.toml").read_text())
    assert clearpostcode.__version__ == pyproject["project"]["version"]
