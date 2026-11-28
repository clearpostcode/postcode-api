"""Every SDK call as an operation and its parameters, once, for the sync and the async client. The address calls sit
behind one adapter (ROUTES), so a change to an address route is one edit."""

from __future__ import annotations

from collections.abc import Sequence
from typing import NotRequired, TypedDict

from ._base import Call
from ._generated import (
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
    ReverseItem,
    Sector,
    Suggestion,
    Usage,
    Validation,
)


class ReversePoint(TypedDict):
    """A point for reverse geocoding."""

    latitude: float
    longitude: float
    #: Search radius in metres (default 500).
    radius: NotRequired[int]
    #: How many postcodes for this point (1 to 10, default 1).
    limit: NotRequired[int]


def _fields(fields: Sequence[PostcodeField] | None) -> str | None:
    return ",".join(fields) if fields else None


def lookup(postcode: str, fields: Sequence[PostcodeField] | None) -> Call[Postcode, Meta]:
    return Call("getPostcode", path={"postcode": postcode}, query={"fields": _fields(fields)})


def validate(postcode: str) -> Call[Validation, Meta]:
    return Call("validatePostcode", path={"postcode": postcode})


def nearest(postcode: str, radius: int | None, limit: int | None) -> Call[list[Near], Meta]:
    return Call("nearestToPostcode", path={"postcode": postcode}, query={"radius": radius, "limit": limit})


def reverse(latitude: float, longitude: float, radius: int | None, limit: int | None) -> Call[list[Near], Meta]:
    return Call("reverseGeocode", query={"lat": latitude, "lon": longitude, "radius": radius, "limit": limit})


def bulk(postcodes: list[str], fields: Sequence[PostcodeField] | None) -> Call[list[BulkItem], Meta]:
    return Call("bulkLookup", query={"fields": _fields(fields)}, body={"postcodes": postcodes})


def bulk_reverse(points: list[ReversePoint]) -> Call[list[ReverseItem], Meta]:
    body = [
        {"lat": p["latitude"], "lon": p["longitude"], **{k: p[k] for k in ("radius", "limit") if k in p}}
        for p in points
    ]
    return Call("bulkReverse", body={"points": body})


def autocomplete(q: str, limit: int | None) -> Call[list[Suggestion], Meta]:
    return Call("autocomplete", query={"q": q, "limit": limit})


def distance(from_: str, to: str) -> Call[Distance, Meta]:
    return Call("distance", query={"from": from_, "to": to})


def outcode(outcode: str) -> Call[District, Meta]:
    return Call("getOutcode", path={"outcode": outcode})


def outcode_postcodes(outcode: str, cursor: str | None, limit: int | None) -> Call[list[OutcodePostcode], Meta]:
    return Call(
        "outcodePostcodes", path={"outcode": outcode}, query={"cursor": cursor, "limit": limit}, cursor_param="cursor"
    )


def sector(sector: str) -> Call[Sector, Meta]:
    return Call("getSector", path={"sector": sector})


def area(area: str) -> Call[Area, Meta]:
    return Call("getArea", path={"area": area})


def places(q: str, limit: int | None) -> Call[list[Place], Meta]:
    return Call("places", query={"q": q, "limit": limit})


def usage() -> Call[Usage, Meta]:
    return Call("usage")


#: Address lookup (Royal Mail PAF, early access): each SDK call's operation and parameter names.
ROUTES = {
    "by_postcode": {"op": "addressesByPostcode", "postcode": "postcode", "cursor": "cursor"},
    "suggest": {"op": "addressSuggest", "q": "q", "container": "container", "limit": "limit"},
    "retrieve": {"op": "addressRetrieve", "id": "id"},
    "by_udprn": {"op": "addressByUdprn", "udprn": "udprn"},
}


def addresses_by_postcode(postcode: str, cursor: str | None) -> Call[list[Address], AddressMeta]:
    r = ROUTES["by_postcode"]
    return Call(r["op"], query={r["postcode"]: postcode, r["cursor"]: cursor}, cursor_param=r["cursor"])


def address_suggest(q: str, container: str | None, limit: int | None) -> Call[list[AddressSuggestion], AddressMeta]:
    r = ROUTES["suggest"]
    return Call(r["op"], query={r["q"]: q or None, r["container"]: container, r["limit"]: limit})


def address_retrieve(id_: str) -> Call[Address, AddressMeta]:
    r = ROUTES["retrieve"]
    return Call(r["op"], path={r["id"]: id_})


def address_by_udprn(udprn: str | int) -> Call[Address, AddressMeta]:
    r = ROUTES["by_udprn"]
    return Call(r["op"], path={r["udprn"]: str(udprn)})
