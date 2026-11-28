"""The sync client."""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable, Iterator, Sequence
from types import TracebackType
from typing import Any, Self, overload

import httpx

from . import _base, _calls
from ._base import BULK_POINTS, BULK_POSTCODES, BulkResult, Call, Page, Result
from ._calls import ReversePoint
from ._errors import APIConnectionError, APIError, APITimeoutError, ClearPostcodeError
from ._generated import (
    BASE_URL,
    Address,
    AddressMeta,
    AddressSuggestion,
    Area,
    BulkItem,
    Distance,
    District,
    Meta,
    Near,
    OutcodePostcode,
    Place,
    Postcode,
    PostcodeField,
    PostcodeRecord,
    ReverseItem,
    Sector,
    Suggestion,
    Usage,
    Validation,
)


class ClearPostcode:
    """The ClearPostcode client.

    The key comes from ``key``, else the CLEAR_POSTCODE_KEY environment variable; with neither (or ``key=""``) calls
    run keyless, on the free allowance. Use it as a context manager, or call ``close()``, to free its connections.
    """

    def __init__(
        self,
        key: str | None = None,
        *,
        base_url: str = BASE_URL,
        timeout: float = 10.0,
        max_retries: int = 2,
        max_retry_delay: float = 60.0,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._config = _base.config(key, base_url, timeout, max_retries, max_retry_delay)
        self._http = http_client or httpx.Client()
        self._owns_http = http_client is None
        self.postcodes = Postcodes(self)
        self.outcodes = Outcodes(self)
        self.sectors = Sectors(self)
        self.areas = Areas(self)
        self.places = Places(self)
        self.account = Account(self)
        self.addresses = Addresses(self)

    def with_options(self, *, timeout: float | None = None, max_retries: int | None = None) -> ClearPostcode:
        """The same client (and connections) with other settings, for one call or a few."""
        cfg = self._config
        return ClearPostcode(
            cfg.key or "",
            base_url=cfg.base_url,
            timeout=cfg.timeout if timeout is None else timeout,
            max_retries=cfg.max_retries if max_retries is None else max_retries,
            max_retry_delay=cfg.max_retry_delay,
            http_client=self._http,
        )

    def _send(self, call: Call[_base.DataT, _base.MetaT]) -> Result[_base.DataT, _base.MetaT]:
        """Make the call, retrying 429s, 5xx answers, timeouts and dropped connections with backoff (a POST: 429 and
        503 only)."""
        cfg = self._config
        attempt = 0
        while True:
            try:
                response = self._http.send(_base.build(cfg, call))
            except httpx.TimeoutException as e:
                error: APIError | APIConnectionError = APITimeoutError(f"No answer within {cfg.timeout} s")
                error.__cause__ = e
                wait = _base.connection_wait(cfg, call, attempt)
            except httpx.TransportError as e:
                error = APIConnectionError(f"Could not reach the ClearPostcode API: {e}")
                error.__cause__ = e
                wait = _base.connection_wait(cfg, call, attempt)
            else:
                out = _base.answer(response, call)
                if isinstance(out, Result):
                    return out
                error = out
                wait = _base.retry_wait(cfg, call, out, attempt)
            if wait is None:
                raise error
            time.sleep(wait)
            attempt += 1

    def _page(self, call: Call[list[_base.ItemT], _base.MetaT]) -> Page[_base.ItemT, _base.MetaT]:
        r = self._send(call)
        nxt = r.meta.get("next_cursor") if isinstance(r.meta, dict) else None
        return Page(
            r.data, r.meta, r.status, r.request_id, r.rate_limit, nxt, lambda cursor: self._page(call.at(cursor))
        )

    def _every(self, first: Callable[[], Page[_base.ItemT, Any]]) -> Iterator[_base.ItemT]:
        page: Page[_base.ItemT, Any] | None = first()
        while page is not None:
            yield from page.data
            page = page.next()

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: TracebackType | None
    ) -> None:
        self.close()


class Postcodes:
    """Postcodes: lookup, validation, nearest, reverse geocoding, bulk, autocomplete and distance."""

    def __init__(self, client: ClearPostcode) -> None:
        self._c = client

    @overload
    def lookup(self, postcode: str) -> Result[PostcodeRecord, Meta]: ...
    @overload
    def lookup(self, postcode: str, *, fields: Sequence[PostcodeField]) -> Result[Postcode, Meta]: ...
    def lookup(
        self, postcode: str, *, fields: Sequence[PostcodeField] | None = None
    ) -> Result[PostcodeRecord, Meta] | Result[Postcode, Meta]:
        """Everything about one postcode (1 lookup when found; not found is free). ``fields`` trims the record."""
        if fields:
            return self._c._send(_calls.lookup_fields(postcode, fields))
        return self._c._send(_calls.lookup(postcode))

    def validate(self, postcode: str) -> Result[Validation, Meta]:
        """Is the format valid, is it in the current edition, is it live? Never raises for a wrong postcode."""
        return self._c._send(_calls.validate(postcode))

    def nearest(
        self, postcode: str, *, radius: int | None = None, limit: int | None = None
    ) -> Result[list[Near], Meta]:
        """Live postcodes nearest this one, nearest first."""
        return self._c._send(_calls.nearest(postcode, radius, limit))

    def reverse(
        self, latitude: float, longitude: float, *, radius: int | None = None, limit: int | None = None
    ) -> Result[list[Near], Meta]:
        """Live postcodes nearest a point (reverse geocoding), out to 20 km."""
        return self._c._send(_calls.reverse(latitude, longitude, radius, limit))

    def bulk(self, postcodes: Iterable[str], *, fields: Sequence[PostcodeField] | None = None) -> BulkResult[BulkItem]:
        """Any number of postcodes, sent 100 a call, in the order given. Needs a secret key."""
        done: list[Result[list[Any], Meta]] = []
        for chunk in _base.chunks(postcodes, BULK_POSTCODES):
            try:
                done.append(self._c._send(_calls.bulk(chunk, fields)))
            except ClearPostcodeError as e:
                e.partial = _base.joined(done)
                raise
        return _base.joined(done)

    def bulk_reverse(self, points: Iterable[ReversePoint]) -> BulkResult[ReverseItem]:
        """Nearest postcodes for any number of points, sent 20 a call. Needs a secret key."""
        done: list[Result[list[Any], Meta]] = []
        for chunk in _base.chunks(points, BULK_POINTS):
            try:
                done.append(self._c._send(_calls.bulk_reverse(chunk)))
            except ClearPostcodeError as e:
                e.partial = _base.joined(done)
                raise
        return _base.joined(done)

    def autocomplete(self, q: str, *, limit: int | None = None) -> Result[list[Suggestion], Meta]:
        """Postcodes (or districts, for 1 to 4 characters) that start with what has been typed. Free."""
        return self._c._send(_calls.autocomplete(q, limit))

    def distance(self, from_: str, to: str) -> Result[Distance, Meta]:
        """Straight-line distance between two postcodes, in kilometres and miles, with the bearing."""
        return self._c._send(_calls.distance(from_, to))


class Outcodes:
    """Postcode districts (outward codes such as SW1A)."""

    def __init__(self, client: ClearPostcode) -> None:
        self._c = client

    def get(self, outcode: str) -> Result[District, Meta]:
        """One district: counts, sectors, centre, councils, wards, constituencies and places."""
        return self._c._send(_calls.outcode(outcode))

    def postcodes(
        self, outcode: str, *, cursor: str | None = None, limit: int | None = None
    ) -> Page[OutcodePostcode, Meta]:
        """One page of the district's live postcodes (1 lookup a page). Needs a secret key."""
        return self._c._page(_calls.outcode_postcodes(outcode, cursor, limit))

    def all_postcodes(self, outcode: str, *, limit: int | None = None) -> Iterator[OutcodePostcode]:
        """Every live postcode in the district, page after page. Needs a secret key."""
        return self._c._every(lambda: self.postcodes(outcode, limit=limit))


class Sectors:
    """Postcode sectors (such as SW1A 1)."""

    def __init__(self, client: ClearPostcode) -> None:
        self._c = client

    def get(self, sector: str) -> Result[Sector, Meta]:
        """One sector: its live postcodes with coordinates, centre, councils and wards."""
        return self._c._send(_calls.sector(sector))


class Areas:
    """Postcode areas (the letters, such as SW)."""

    def __init__(self, client: ClearPostcode) -> None:
        self._c = client

    def get(self, area: str) -> Result[Area, Meta]:
        """One area: its name, counts and every district in it."""
        return self._c._send(_calls.area(area))


class Places:
    """Places by name (OS Open Names)."""

    def __init__(self, client: ClearPostcode) -> None:
        self._c = client

    def search(self, q: str, *, limit: int | None = None) -> Result[list[Place], Meta]:
        """Cities, towns, villages and neighbourhoods whose name starts with ``q``; accents optional."""
        return self._c._send(_calls.places(q, limit))


class Account:
    """Your account."""

    def __init__(self, client: ClearPostcode) -> None:
        self._c = client

    def usage(self) -> Result[Usage, Meta]:
        """Your plan, this period's allowance, lookups used, credits and when it resets. Free. Needs a secret key."""
        return self._c._send(_calls.usage())


class Addresses:
    """Address lookup (Royal Mail PAF, early access). Needs a key whose business has Address lookup switched on in the
    dashboard; until then every call raises PermissionDeniedError with code address_lookup_not_enabled."""

    def __init__(self, client: ClearPostcode) -> None:
        self._c = client

    def by_postcode(self, postcode: str, *, cursor: str | None = None) -> Page[Address, AddressMeta]:
        """One page of the addresses at a postcode, in delivery order (up to 100 a page; 1 address credit a page)."""
        return self._c._page(_calls.addresses_by_postcode(postcode, cursor))

    def all_by_postcode(self, postcode: str) -> Iterator[Address]:
        """Every address at a postcode, page after page."""
        return self._c._every(lambda: self.by_postcode(postcode))

    def suggest(
        self, q: str, *, container: str | None = None, limit: int | None = None
    ) -> Result[list[AddressSuggestion], AddressMeta]:
        """Suggestions as the customer types (free): kind "address" is one address (resolve its id with retrieve()),
        kind "container" a postcode, street or building holding ``count`` addresses (pass its id as ``container``)."""
        return self._c._send(_calls.address_suggest(q, container, limit))

    def retrieve(self, id_: str) -> Result[Address, AddressMeta]:
        """The full address for an address suggestion's id (1 address credit)."""
        return self._c._send(_calls.address_retrieve(id_))

    def by_udprn(self, udprn: str | int) -> Result[Address, AddressMeta]:
        """The full address for a UDPRN, Royal Mail's number for one delivery point (1 address credit)."""
        return self._c._send(_calls.address_by_udprn(udprn))
