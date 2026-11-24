# ClearPostcode: UK postcode API for JavaScript

Look up, validate and autocomplete any UK postcode, and get its council, ward, constituency, coordinates, police force
and more, from the ONS Postcode Directory and OS Open Names. Nearest postcodes, reverse geocoding, distances and
places too. No dependencies. Free: 10,000 lookups a month, no card, and the common lookups work with no key at all.

```sh
npm install clearpostcode
```

```js
import { ClearPostcode } from "clearpostcode";

const cp = new ClearPostcode(); // add { key: process.env.CLEAR_POSTCODE_KEY } for your full allowance
const { data, meta } = await cp.lookup("SW1A 1AA");
console.log(data.local_authority.name, data.constituency.name); // Westminster, Cities of London and Westminster
console.log(meta.attribution); // credit lines to show with the data
```

Every answer is `{ data, meta }`. Every failure throws a `ClearPostcodeError` with `status`, `problem` (the RFC 9457
problem body) and `request_id`:

```js
import { ClearPostcode, ClearPostcodeError } from "clearpostcode";

try {
  await new ClearPostcode().lookup("not a postcode");
} catch (e) {
  if (e instanceof ClearPostcodeError) console.log(e.status, e.problem.title, e.request_id);
}
```

| Method | Endpoint | Key |
|---|---|---|
| `lookup(postcode, { fields })` | `GET /postcodes/{postcode}` | optional |
| `validate(postcode)` | `GET /postcodes/{postcode}/validate` | optional |
| `nearest(postcode, { radius, limit })` | `GET /postcodes/{postcode}/nearest` | optional |
| `reverse({ lat, lon, radius, limit })` | `GET /postcodes` | optional |
| `autocomplete(q, { limit })` | `GET /autocomplete` | optional |
| `distance(from, to)` | `GET /distance` | optional |
| `outcode(outcode)`, `sector(sector)`, `area(area)` | `GET /outcodes`, `/sectors`, `/areas` | optional |
| `places(q, { limit })` | `GET /places` | optional |
| `bulk(postcodes, { fields })` | `POST /postcodes` (up to 100) | secret key |
| `bulkReverse(points)` | `POST /reverse` (up to 20) | secret key |
| `outcodePostcodes(outcode, { after, limit })` | `GET /outcodes/{outcode}/postcodes` | secret key |
| `usage()` | `GET /usage` | any key |
| `addresses(postcode)`, `addressSuggest(q)`, `address(udprn)` | `GET /addresses` (early access) | key |

Keys start `cp_live_` (secret, keep on the server) or `cp_pub_` (publishable, safe in a browser).

- Free key and plans: https://clearpostcode.co.uk/developers
- Docs, every field: https://clearpostcode.co.uk/developers/docs
- OpenAPI: https://clearpostcode.co.uk/openapi.json
- AI assistants (MCP): https://clearpostcode.co.uk/mcp

Contains OS data © Crown copyright and database right; Royal Mail data © Royal Mail copyright and database right;
Office for National Statistics data licensed under the Open Government Licence v3.0.
