from __future__ import annotations

import io
import json
import urllib.error
import urllib.request
from collections.abc import Callable
from email.message import Message
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from clearpostcode import BASE, ClearPostcode, ClearPostcodeError

OK = {"data": {"postcode": "SW1A 1AA"}, "meta": {"edition": "2026-08"}}


def _response(payload: Any) -> Callable[..., MagicMock]:
    """A fresh response each call, so one patch can serve several requests."""

    def make(*_args: Any, **_kwargs: Any) -> MagicMock:
        resp = MagicMock()
        resp.__enter__.return_value = io.BytesIO(json.dumps(payload).encode())
        return resp

    return make


def _http_error(status: int, body: bytes, headers: dict[str, str] | None = None) -> urllib.error.HTTPError:
    msg = Message()
    for k, v in (headers or {}).items():
        msg[k] = v
    return urllib.error.HTTPError(BASE, status, "err", msg, io.BytesIO(body))


def _sent(mock: MagicMock) -> urllib.request.Request:
    req: urllib.request.Request = mock.call_args.args[0]
    return req


def test_lookup_encodes_postcode_and_is_keyless() -> None:
    with patch("urllib.request.urlopen", side_effect=_response(OK)) as m:
        r = ClearPostcode().lookup("SW1A 1AA", fields="location,ward")
    req = _sent(m)
    assert r["data"]["postcode"] == "SW1A 1AA"
    assert req.full_url == f"{BASE}/postcodes/SW1A%201AA?fields=location%2Cward"
    assert req.get_method() == "GET"
    assert req.get_header("X-api-key") is None
    assert (req.get_header("User-agent") or "").startswith("clearpostcode-python/")


def test_key_goes_in_x_api_key() -> None:
    with patch("urllib.request.urlopen", side_effect=_response(OK)) as m:
        ClearPostcode(key="cp_pub_abc").validate("m1 1ae")
    req = _sent(m)
    assert req.get_header("X-api-key") == "cp_pub_abc"
    assert req.full_url == f"{BASE}/postcodes/m1%201ae/validate"


def test_none_query_values_are_dropped() -> None:
    c = ClearPostcode()
    with patch("urllib.request.urlopen", side_effect=_response(OK)) as m:
        c.nearest("SW1A 1AA", limit=3)
        assert _sent(m).full_url == f"{BASE}/postcodes/SW1A%201AA/nearest?limit=3"
        c.reverse(51.501, -0.1416)
        assert _sent(m).full_url == f"{BASE}/postcodes?lat=51.501&lon=-0.1416"
        c.autocomplete("SW1A 1", limit=2)
        assert _sent(m).full_url == f"{BASE}/autocomplete?q=SW1A+1&limit=2"
        c.distance("SW1A 1AA", "M1 1AE")
        assert _sent(m).full_url == f"{BASE}/distance?from=SW1A+1AA&to=M1+1AE"
        c.places("Leeds")
        assert _sent(m).full_url == f"{BASE}/places?q=Leeds"


def test_geography_and_account_paths() -> None:
    c = ClearPostcode()
    with patch("urllib.request.urlopen", side_effect=_response(OK)) as m:
        calls: list[tuple[Callable[[], Any], str]] = [
            (lambda: c.outcode("SW1A"), "/outcodes/SW1A"),
            (
                lambda: c.outcode_postcodes("SW1A", after="SW1A 2AA", limit=50),
                "/outcodes/SW1A/postcodes?after=SW1A+2AA&limit=50",
            ),
            (lambda: c.sector("SW1A 1"), "/sectors/SW1A%201"),
            (lambda: c.area("SW"), "/areas/SW"),
            (lambda: c.usage(), "/usage"),
            (lambda: c.addresses("SW1A 1AA"), "/addresses?postcode=SW1A+1AA"),
            (lambda: c.address_suggest("10 downing"), "/addresses/suggest?q=10+downing"),
            (lambda: c.address(123), "/addresses/123"),
        ]
        for call, path in calls:
            call()
            assert _sent(m).full_url == BASE + path


def test_bulk_and_bulk_reverse_post_json() -> None:
    c = ClearPostcode(key="cp_live_x")
    with patch("urllib.request.urlopen", side_effect=_response(OK)) as m:
        c.bulk(["SW1A 1AA", "M1 1AE"], fields="location")
        req = _sent(m)
        assert req.get_method() == "POST"
        assert req.full_url == f"{BASE}/postcodes?fields=location"
        assert json.loads(req.data) == {"postcodes": ["SW1A 1AA", "M1 1AE"]}  # type: ignore[arg-type]
        assert req.get_header("Content-type") == "application/json"
        c.bulk_reverse([{"lat": 51.5, "lon": -0.14, "limit": 1}])
        req = _sent(m)
        assert req.full_url == f"{BASE}/reverse"
        assert json.loads(req.data) == {"points": [{"lat": 51.5, "lon": -0.14, "limit": 1}]}  # type: ignore[arg-type]


def test_error_carries_status_problem_and_request_id() -> None:
    problem = {
        "type": "https://clearpostcode.co.uk/developers/docs/errors#invalid_postcode",
        "title": "That is not a UK postcode",
        "status": 400,
        "detail": '"ZZ" is not in the format of a UK postcode.',
        "request_id": "abc123",
    }
    err = _http_error(400, json.dumps(problem).encode())
    with patch("urllib.request.urlopen", side_effect=err), pytest.raises(ClearPostcodeError) as exc:
        ClearPostcode().lookup("ZZ")
    assert exc.value.status == 400
    assert exc.value.problem == problem
    assert exc.value.request_id == "abc123"
    assert "not in the format" in str(exc.value)


def test_request_id_falls_back_to_header_and_non_json_errors_are_typed() -> None:
    err = _http_error(502, b"<html>bad gateway</html>", {"x-request-id": "hdr-1"})
    with patch("urllib.request.urlopen", side_effect=err), pytest.raises(ClearPostcodeError) as exc:
        ClearPostcode().usage()
    assert exc.value.status == 502
    assert exc.value.request_id == "hdr-1"
    assert exc.value.problem == {}
    assert str(exc.value) == "HTTP 502"
