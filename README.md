# ClearPostcode: UK postcode data API and AI-assistant connector

Every UK postcode, answered instantly: look up, validate and autocomplete, with its council, ward, constituency,
coordinates, police force, NHS area and deprivation decile. Find the nearest postcodes, reverse geocode a point, measure
the distance between two postcodes and search places. Built on the ONS Postcode Directory and OS Open Names, and free to
start: **10,000 postcode lookups a month, free, no card.**

Two products, one key: **Postcode data** (every UK postcode with its council, ward, constituency, coordinates and more,
from open data) and **Address lookup** (every address at a postcode, from Royal Mail PAF; early access).

- **Website and free key:** https://clearpostcode.co.uk/developers
- **Docs, every field:** https://clearpostcode.co.uk/developers/docs
- **REST base:** `https://api.clearpostcode.co.uk/v1` (key optional on single postcode lookups, CORS on) · [OpenAPI 3.1](https://clearpostcode.co.uk/openapi.json)
- **AI-assistant connector (MCP, Streamable HTTP):** https://clearpostcode.co.uk/mcp · registry name `uk.co.clearpostcode/postcodes`

Send your key in an `x-api-key` header. Keys start `cp_live_` (secret, for servers) or `cp_pub_` (publishable, safe in
a browser). Every answer is `{ data, meta }`; every error is an RFC 9457 `application/problem+json` body carrying a
`request_id`.

## Use it in your assistant

1. **Claude:** Settings, Connectors, Add custom connector, then paste `https://clearpostcode.co.uk/mcp`.
2. **ChatGPT:** Settings, Apps and connectors, Create, then paste the address (developer mode).
3. **Cursor, VS Code and other MCP clients:**

```json
{ "mcpServers": { "clearpostcode": { "type": "http", "url": "https://clearpostcode.co.uk/mcp" } } }
```

Ask for a postcode's council, ward or constituency, check one is valid, or find the nearest postcodes to a place. A key
is optional: add it as `Authorization: Bearer <key>` to raise your limits.

## Use it in code

```sh
curl https://api.clearpostcode.co.uk/v1/postcodes/SW1A%201AA
npm install clearpostcode      # JavaScript and TypeScript: ./npm, https://www.npmjs.com/package/clearpostcode
uv add clearpostcode           # Python 3.12+: ./pypi, https://pypi.org/project/clearpostcode/
```

JavaScript and TypeScript (no dependencies, ESM and types):

```js
import { ClearPostcode } from "clearpostcode";

const cp = new ClearPostcode({ key: process.env.CLEAR_POSTCODE_KEY }); // key optional
const { data } = await cp.lookup("SW1A 1AA");
console.log(data.local_authority.name, data.constituency.name); // Westminster, Cities of London and Westminster
console.log((await cp.validate("m1 1ae")).data.valid); // true
```

Python (standard library only):

```python
from clearpostcode import ClearPostcode

cp = ClearPostcode(key="cp_live_...")  # key optional
r = cp.lookup("SW1A 1AA")
print(r["data"]["local_authority"]["name"], r["data"]["constituency"]["name"])
print(cp.validate("m1 1ae")["data"]["valid"])  # True
```

Both clients cover every endpoint (postcode lookup, validate, nearest, reverse, bulk, autocomplete, distance, outcodes, sectors,
areas, places, usage and the early-access address lookup endpoints) and raise a typed error with `status`, `problem` and
`request_id`. Per-package pages: [npm](npm/README.md) · [pypi](pypi/README.md).

## Add a postcode check to your WordPress or WooCommerce site

Install the plugin in [`wordpress/clear-postcode`](wordpress/clear-postcode). It checks billing and shipping postcodes
at WooCommerce checkout (classic and Checkout block) with your publishable key, and adds a postcode checker anywhere
with `[clear_postcode_lookup]`.

## Try it in Postman

Import [`postman/clear-postcode.postman_collection.json`](postman/clear-postcode.postman_collection.json), set the
`apiKey` variable (or leave it empty for keyless endpoints) and send any of the 17 ready-made requests. Rebuild it from
the live OpenAPI document with `node postman/generate.mjs`.

## Plans

Free: 10,000 postcode lookups a month, no card. Paid plans for more ([plans](https://clearpostcode.co.uk/pricing)). Not-found
answers, autocomplete and `304 Not Modified` responses cost nothing.

## Licence

Code in this repository: MIT. Postcode data: Contains OS data © Crown copyright and database right; Royal Mail data ©
Royal Mail copyright and database right; Office for National Statistics data licensed under the Open Government
Licence v3.0.
