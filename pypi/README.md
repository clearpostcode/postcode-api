# ClearPostcode: UK postcode data API for Python

Postcode data for any UK postcode: look it up, validate and autocomplete it, and get its council, ward, constituency, coordinates, police force
and more, from the ONS Postcode Directory and OS Open Names. Nearest postcodes, reverse geocoding, distances and
places too. Standard library only. Free: 10,000 postcode lookups a month, no card, and single postcode lookups work with no key at all.

```sh
uv add clearpostcode   # or: uv pip install clearpostcode
```

```python
from clearpostcode import ClearPostcode

cp = ClearPostcode()  # add key="cp_live_..." for your full allowance
r = cp.lookup("SW1A 1AA")
print(
    r["data"]["local_authority"]["name"], r["data"]["constituency"]["name"]
)  # Westminster, Cities of London and Westminster
print(r["meta"]["attribution"])  # credit lines to show with the data
```

Every answer is a dict with `data` and `meta`. Every failure raises `ClearPostcodeError` with `status`, `problem` (the
RFC 9457 problem body) and `request_id`:

```python
from clearpostcode import ClearPostcode, ClearPostcodeError

try:
    ClearPostcode().lookup("not a postcode")
except ClearPostcodeError as e:
    print(e.status, e.problem["title"], e.request_id)
```

| Method | Endpoint | Key |
|---|---|---|
| `lookup(postcode, fields=None)` | `GET /postcodes/{postcode}` | optional |
| `validate(postcode)` | `GET /postcodes/{postcode}/validate` | optional |
| `nearest(postcode, radius=None, limit=None)` | `GET /postcodes/{postcode}/nearest` | optional |
| `reverse(lat, lon, radius=None, limit=None)` | `GET /postcodes` | optional |
| `autocomplete(q, limit=None)` | `GET /autocomplete` | optional |
| `distance(from_postcode, to_postcode)` | `GET /distance` | optional |
| `outcode(outcode)`, `sector(sector)`, `area(area)` | `GET /outcodes`, `/sectors`, `/areas` | optional |
| `places(q, limit=None)` | `GET /places` | optional |
| `bulk(postcodes, fields=None)` | `POST /postcodes` (up to 100) | secret key |
| `bulk_reverse(points)` | `POST /reverse` (up to 20) | secret key |
| `outcode_postcodes(outcode, after=None, limit=None)` | `GET /outcodes/{outcode}/postcodes` | secret key |
| `usage()` | `GET /usage` | any key |
| `addresses(postcode)`, `address_suggest(q)`, `address(udprn)` | `GET /addresses` (early access, Royal Mail PAF) | key |

Keys start `cp_live_` (secret, keep on the server) or `cp_pub_` (publishable, safe in a browser).

- Free key and plans: https://clearpostcode.co.uk/developers
- Docs, every field: https://clearpostcode.co.uk/developers/docs
- OpenAPI: https://clearpostcode.co.uk/openapi.json
- AI assistants (MCP): https://clearpostcode.co.uk/mcp

Contains OS data © Crown copyright and database right; Royal Mail data © Royal Mail copyright and database right;
Office for National Statistics data licensed under the Open Government Licence v3.0.
