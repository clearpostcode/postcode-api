"""ClearPostcode API client for UK postcode data: lookup, validation, autocomplete, nearest, reverse geocoding,
distance and area data. Standard library only. Docs: https://clearpostcode.co.uk/developers/docs"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

__version__ = "1.0.0"
BASE = "https://api.clearpostcode.co.uk/v1"
__all__ = ["BASE", "ClearPostcode", "ClearPostcodeError"]

Answer = dict[str, Any]


class ClearPostcodeError(Exception):
    """A non-2xx answer. `problem` is the RFC 9457 problem+json body; `request_id` is the id to quote to support."""

    def __init__(self, status: int, problem: dict[str, Any] | None = None, request_id: str | None = None):
        problem = problem or {}
        super().__init__(problem.get("detail") or problem.get("title") or f"HTTP {status}")
        self.status = status
        self.problem = problem
        self.request_id = request_id or problem.get("request_id")


def _seg(value: object) -> str:
    return urllib.parse.quote(str(value).strip(), safe="")


class ClearPostcode:
    """key: cp_live_ (secret) or cp_pub_ (publishable). Most calls also work without one (rate-limited per IP)."""

    def __init__(self, key: str | None = None, base: str = BASE, timeout: float = 20):
        self.key, self.base, self.timeout = key, base, timeout

    def request(
        self,
        method: str,
        path: str,
        query: dict[str, Any] | None = None,
        body: Any = None,
    ) -> Answer:
        params = {k: v for k, v in (query or {}).items() if v is not None}
        url = self.base + path + (f"?{urllib.parse.urlencode(params)}" if params else "")
        headers = {"user-agent": f"clearpostcode-python/{__version__}", "accept": "application/json"}
        if self.key:
            headers["x-api-key"] = self.key
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["content-type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                result: Answer = json.load(r)
                return result
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                problem = json.loads(raw) if raw else {}
            except ValueError:
                problem = {}
            if not isinstance(problem, dict):
                problem = {}
            raise ClearPostcodeError(e.code, problem, e.headers.get("x-request-id") if e.headers else None) from None

    def get(self, path: str, query: dict[str, Any] | None = None) -> Answer:
        return self.request("GET", path, query)

    def post(self, path: str, body: Any, query: dict[str, Any] | None = None) -> Answer:
        return self.request("POST", path, query, body)

    # Postcodes
    def lookup(self, postcode: str, fields: str | None = None) -> Answer:
        """Everything about one postcode. fields: comma-separated top-level fields to return."""
        return self.get(f"/postcodes/{_seg(postcode)}", {"fields": fields})

    def validate(self, postcode: str) -> Answer:
        """Format valid? In the current edition? Live?"""
        return self.get(f"/postcodes/{_seg(postcode)}/validate")

    def nearest(self, postcode: str, radius: int | None = None, limit: int | None = None) -> Answer:
        """Postcodes near a postcode. radius in metres (up to 2000), limit 1 to 50."""
        return self.get(f"/postcodes/{_seg(postcode)}/nearest", {"radius": radius, "limit": limit})

    def reverse(self, lat: float, lon: float, radius: int | None = None, limit: int | None = None) -> Answer:
        """Postcodes near a point (reverse geocode)."""
        return self.get("/postcodes", {"lat": lat, "lon": lon, "radius": radius, "limit": limit})

    def bulk(self, postcodes: list[str], fields: str | None = None) -> Answer:
        """Up to 100 postcodes in one call. Needs a secret key."""
        return self.post("/postcodes", {"postcodes": postcodes}, {"fields": fields})

    def bulk_reverse(self, points: list[dict[str, Any]]) -> Answer:
        """Up to 20 points in one call: [{"lat": ..., "lon": ..., "limit": 1}]. Needs a secret key."""
        return self.post("/reverse", {"points": points})

    def autocomplete(self, q: str, limit: int | None = None) -> Answer:
        """Complete a partial postcode. limit: 1 to 20."""
        return self.get("/autocomplete", {"q": q, "limit": limit})

    def distance(self, from_postcode: str, to_postcode: str) -> Answer:
        """Distance between two postcodes."""
        return self.get("/distance", {"from": from_postcode, "to": to_postcode})

    # Geography
    def outcode(self, outcode: str) -> Answer:
        return self.get(f"/outcodes/{_seg(outcode)}")

    def outcode_postcodes(self, outcode: str, after: str | None = None, limit: int | None = None) -> Answer:
        """Every postcode in a district, a page at a time. after: last postcode of the last page. Needs a secret key."""
        return self.get(f"/outcodes/{_seg(outcode)}/postcodes", {"after": after, "limit": limit})

    def sector(self, sector: str) -> Answer:
        return self.get(f"/sectors/{_seg(sector)}")

    def area(self, area: str) -> Answer:
        return self.get(f"/areas/{_seg(area)}")

    # Places
    def places(self, q: str, limit: int | None = None) -> Answer:
        """Find a place by name. limit: 1 to 20."""
        return self.get("/places", {"q": q, "limit": limit})

    # Account
    def usage(self) -> Answer:
        """Your month's usage. Needs a key."""
        return self.get("/usage")

    # Addresses (early access)
    def addresses(self, postcode: str) -> Answer:
        return self.get("/addresses", {"postcode": postcode})

    def address_suggest(self, q: str) -> Answer:
        return self.get("/addresses/suggest", {"q": q})

    def address(self, udprn: str | int) -> Answer:
        return self.get(f"/addresses/{_seg(udprn)}")
