# clearpostcode

Every UK postcode, answered in milliseconds: look up, validate and autocomplete postcodes, with the council, ward,
constituency, coordinates, police force, NHS area and deprivation decile behind each one. Find the nearest postcodes,
reverse geocode a point, measure distances, list a district, search places, and look up full Royal Mail addresses.

- **Typed end to end:** every answer is a `TypedDict` generated from the API's OpenAPI document, every error a class,
  and a full lookup is a `PostcodeRecord` with every field. mypy strict and pyright check each one.
- **Sync and async:** `ClearPostcode` and `AsyncClearPostcode`, on httpx, with context managers.
- **Built for production:** automatic retries with backoff that honour `Retry-After` and the rate-limit headers,
  timeouts, cursor pagination and bulk calls of any size.
- **Free to start:** 10,000 postcode lookups a month on a free key, no card, and many calls work with no key at all.

Two products, one key: **Postcode data** (every UK postcode and its areas, from open data) and **Address lookup**
(every address at a postcode, from Royal Mail PAF). Python 3.11 or later.

## Install

```sh
uv add clearpostcode        # or: pip install clearpostcode
```

## Quickstart

Runs as printed, with or without a key. The client reads your key from `CLEAR_POSTCODE_KEY` when it is set; without
one, calls run on the free keyless allowance.

```python
from clearpostcode import ClearPostcode

with ClearPostcode() as cp:
    pc = cp.postcodes.lookup("SW1A 1AA").data
    council, seat = pc["local_authority"], pc["constituency"]
    print(council and council["name"], seat and seat["name"])
    # Westminster Cities of London and Westminster

    check = cp.postcodes.validate("m1 1ae").data
    print(check["valid"], check["postcode"])  # True M1 1AE

    print(len(cp.postcodes.autocomplete("SW1A 1").data) > 0)  # True
```

Get a free key in under a minute at [clearpostcode.co.uk/developers](https://clearpostcode.co.uk/developers#key):
secret keys start `cp_live_`.

```sh
export CLEAR_POSTCODE_KEY=cp_live_...
```

## What you can call

| Call | What it answers |
|---|---|
| `postcodes.lookup(postcode, fields=[...])` | The full record: status, coordinates, council, ward, constituency and every other area |
| `postcodes.validate(postcode)` | Is the format valid, is it in the current edition, is it live |
| `postcodes.autocomplete(q, limit=)` | Postcodes (or districts) that start with what was typed. Free |
| `postcodes.nearest(postcode, radius=, limit=)` | Live postcodes nearest a postcode, with distances |
| `postcodes.reverse(latitude, longitude, radius=, limit=)` | Live postcodes nearest a point |
| `postcodes.distance(from_, to)` | Kilometres, miles and the bearing between two postcodes |
| `postcodes.bulk(postcodes, fields=[...])` | Any number of postcodes, sent 100 a call. Secret key |
| `postcodes.bulk_reverse(points)` | Nearest postcodes for any number of points, 20 a call. Secret key |
| `outcodes.get(outcode)` | A district: counts, sectors, centre, councils, wards, places |
| `outcodes.postcodes(outcode)` / `outcodes.all_postcodes(outcode)` | Every live postcode in a district, by page or all of them. Secret key |
| `sectors.get(sector)` · `areas.get(area)` | A sector or an area |
| `places.search(q)` | Cities, towns, villages and neighbourhoods by name |
| `account.usage()` | Your plan, allowance, lookups used and reset date. Secret key |
| `addresses.suggest`, `retrieve`, `by_postcode`, `all_by_postcode`, `by_udprn` | Address lookup (below) |

Every call answers a frozen `Result`: `data` and `meta` as the API sends them, plus `status`, `request_id` and
`rate_limit` (`policy`, `limit`, `remaining`, `reset`). Every field is documented at
[clearpostcode.co.uk/developers/docs](https://clearpostcode.co.uk/developers/docs).

```python
from clearpostcode import ClearPostcode

with ClearPostcode() as cp:
    r = cp.postcodes.lookup("EH1 1YZ", fields=["location", "ward"])
    ward, where = r.data.get("ward"), r.data.get("location")
    print(ward and ward["name"], where and where["latitude"])  # City Centre 55.950328
    print(r.request_id is not None, r.rate_limit is not None)  # True True
```

## Async

```python
import asyncio

from clearpostcode import AsyncClearPostcode


async def main() -> None:
    async with AsyncClearPostcode() as cp:
        a, b = await asyncio.gather(cp.postcodes.lookup("M1 1AE"), cp.postcodes.lookup("CF10 1EP"))
        councils = [r.data["local_authority"] for r in (a, b)]
        print(*(c["name"] for c in councils if c))  # Manchester Cardiff


asyncio.run(main())
```

## Errors

Every error is a `ClearPostcodeError`. When the API answers with an error, you get an `APIError` subclass carrying
the problem's `code`, `detail`, `status` and the `request_id` to quote to support:

```python
from clearpostcode import ClearPostcode, NotFoundError

with ClearPostcode() as cp:
    try:
        cp.postcodes.lookup("SW1A 9ZZ")
    except NotFoundError as e:
        print(e.code)  # postcode_not_found
```

| Class | Status | Codes |
|---|---|---|
| `BadRequestError` | 400, 413 | `invalid_postcode`, `unknown_parameter`, `bad_request`, `secret_key_in_url`, `body_too_large` |
| `AuthenticationError` | 401 | `invalid_key`, `key_required` |
| `QuotaExceededError` | 402 | `quota_exceeded`, `address_credits_exhausted` |
| `PermissionDeniedError` | 403 | `origin_not_allowed`, `publishable_key_not_allowed`, `secret_key_in_browser`, `address_lookup_not_enabled` |
| `NotFoundError` | 404 | `postcode_not_found`, `not_covered`, `not_found` |
| `UnprocessableEntityError` | 422 | `no_position` |
| `RateLimitError` | 429 | `rate_limited`, `daily_cap_reached`, `suggestions_capped` |
| `InternalServerError` | 5xx | `server_error`, `service_unavailable` |
| `APIConnectionError`, `APITimeoutError` | | The API could not be reached, or did not answer in time |

## Retries and timeouts

429s, 5xx answers, timeouts and dropped connections are retried twice by default, with exponential backoff and
jitter. A `Retry-After` from the API is honoured exactly, and a 429 without one waits for the `RateLimit` reset. A
wait longer than `max_retry_delay` (a key's daily cap until midnight, say) is raised at once, with `retry_after` in
seconds.

```python
from clearpostcode import ClearPostcode

with ClearPostcode(timeout=5.0, max_retries=3) as cp:
    print(cp.with_options(timeout=2.0).postcodes.validate("SW1A 1AA").data["valid"])  # True
```

## Pages and bulk calls

```python secret
from clearpostcode import ClearPostcode

with ClearPostcode() as cp:  # a secret key in CLEAR_POSTCODE_KEY
    print(sum(1 for _ in cp.outcodes.all_postcodes("SW1A")) > 100)  # True: every live postcode, page after page

    r = cp.postcodes.bulk(["SW1A 1AA", "M1 1AE", "EH1 1YZ"], fields=["local_authority"])
    print(r.meta["found"] if r.meta else 0)  # 3
```

Bulk calls take lists of any length: the client sends 100 postcodes (or 20 points) a call, one after another, and
joins the answers in the order you sent them. If a chunk fails part-way (the month's lookups run out, say), the error
carries `partial`: everything the chunks before it answered, so nothing you paid for is lost. Bulk calls are retried
only on answers that say nothing was billed (429 and 503).

## Address lookup

Full UK address lookup on Royal Mail's Postcode Address File: the customer types a postcode or the start of an
address, picks it from the list, and you save a clean Royal Mail address. It is in early access and switches on per
account: once the business your key serves has Address lookup switched on in your
[dashboard](https://clearpostcode.co.uk/dashboard#address-lookup), every call below answers. Until then they raise
`PermissionDeniedError` with code `address_lookup_not_enabled`. Join at
[clearpostcode.co.uk/address-lookup](https://clearpostcode.co.uk/address-lookup).

```python secret
from clearpostcode import ClearPostcode

with ClearPostcode() as cp:
    # Suggestions are free (within a daily allowance per business). Kind "container" lists what it holds.
    found = cp.addresses.suggest("2 high street porthmore").data
    if found and found[0]["kind"] == "container":
        found = cp.addresses.suggest("", container=found[0]["id"]).data
    pick = found[0] if found else None

    # Resolving an address costs one address credit.
    if pick and pick["kind"] == "address":
        address = cp.addresses.retrieve(pick["id"]).data
        print(address["line_1"], address["post_town"], address["postcode"])

    # Every address at a postcode, 100 a page.
    for a in cp.addresses.all_by_postcode("AB10 1AA"):
        print(a["udprn"], a["line_1"])
```

## Plans

Free: 10,000 postcode lookups a month, no card. Not-found answers, autocomplete and address suggestions cost nothing.
More lookups and Address lookup: [clearpostcode.co.uk/pricing](https://clearpostcode.co.uk/pricing). What's new:
[CHANGELOG](https://github.com/clearpostcode/postcode-api/blob/main/CHANGELOG.md).

## Licence

MIT. Postcode data: Contains OS data © Crown copyright and database right; Royal Mail data © Royal Mail copyright and
database right; Office for National Statistics data licensed under the Open Government Licence v3.0.
