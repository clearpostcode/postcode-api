# ClearPostcode: UK postcode data API, SDKs and AI-assistant connector

Every UK postcode, answered instantly: look up, validate and autocomplete, with its council, ward, constituency,
coordinates, police force, NHS area and deprivation decile. Find the nearest postcodes, reverse geocode a point, measure
the distance between two postcodes and search places. Built on the ONS Postcode Directory and OS Open Names, and free to
start: **10,000 postcode lookups a month, free, no card.**

Two products, one key: **Postcode data** (every UK postcode with its council, ward, constituency, coordinates and more,
from open data) and **Address lookup** (every address at a postcode, from Royal Mail PAF; early access, switched on per
account).

- **Website and free key:** https://clearpostcode.co.uk/developers
- **Docs, every field:** https://clearpostcode.co.uk/developers/docs
- **REST base:** `https://api.clearpostcode.co.uk/v1` (CORS on; postcode lookups, validation and autocomplete work
  without a key) · [OpenAPI 3.1](https://api.clearpostcode.co.uk/openapi.json)
- **AI-assistant connector (MCP, Streamable HTTP):** `https://api.clearpostcode.co.uk/mcp` · registry name
  `uk.co.clearpostcode/postcodes`

Send your key in an `X-Api-Key` header. Keys start `cp_live_` (secret, for servers) or `cp_pub_` (publishable, locked
to your domains, safe in a browser). Every answer is `{ data, meta }`; every error is an RFC 9457
`application/problem+json` body carrying a `request_id`.

## In this repository

| Folder | What it is |
|---|---|
| [`npm`](npm) | [`clearpostcode` on npm](https://www.npmjs.com/package/clearpostcode): JavaScript and TypeScript, Node, Bun, Deno, Workers and browsers |
| [`pypi`](pypi) | [`clearpostcode` on PyPI](https://pypi.org/project/clearpostcode/): Python 3.11+, sync and async |
| [`wordpress/clear-postcode`](wordpress/clear-postcode) | The WordPress and WooCommerce plugin |
| [`postman`](postman) | The Postman collection |
| [`openapi`](openapi) | The OpenAPI document both SDKs are generated from |
| [`server.json`](server.json) | The MCP registry entry |

## Use it in code

```sh
curl https://api.clearpostcode.co.uk/v1/postcodes/SW1A%201AA
npm install clearpostcode      # JavaScript and TypeScript
uv add clearpostcode           # Python (or pip install clearpostcode)
```

Both SDKs read your key from `CLEAR_POSTCODE_KEY` and run keyless without one, so these run as printed:

```js
import { ClearPostcode } from "clearpostcode";

const cp = new ClearPostcode();
const { data } = await cp.postcodes.lookup("SW1A 1AA");
console.log(data.local_authority?.name, data.constituency?.name); // Westminster Cities of London and Westminster
```

```python
from clearpostcode import ClearPostcode

with ClearPostcode() as cp:
    pc = cp.postcodes.lookup("SW1A 1AA").data
    print(pc["local_authority"]["name"], pc["constituency"]["name"])  # Westminster Cities of London and Westminster
```

Both cover every endpoint (postcodes, districts, sectors, areas, places, usage and Address lookup), with types
generated from the OpenAPI document, typed errors carrying the `request_id`, retries that honour `Retry-After` and the
rate-limit headers, timeouts, cursor pagination and bulk calls of any size. Per-package guides: [npm](npm/README.md) ·
[PyPI](pypi/README.md). What's new: [CHANGELOG](CHANGELOG.md).

## Use it in your assistant

1. **Claude:** Settings, Connectors, Add custom connector, then paste `https://api.clearpostcode.co.uk/mcp`.
2. **ChatGPT:** Settings, Apps and connectors, Create, then paste the address (developer mode).
3. **Cursor, VS Code and other MCP clients:**

```json
{ "mcpServers": { "clearpostcode": { "type": "http", "url": "https://api.clearpostcode.co.uk/mcp" } } }
```

Ask for a postcode's council, ward or constituency, check one is valid, or find the nearest postcodes to a place. A key
is optional: add it as `Authorization: Bearer <key>` to raise your limits.

## Add a postcode check to your WordPress or WooCommerce site

[Download clear-postcode.zip](https://github.com/clearpostcode/postcode-api/releases/latest/download/clear-postcode.zip)
and upload it under Plugins, Add New Plugin, Upload Plugin. It checks billing and shipping postcodes at WooCommerce
checkout (classic and Checkout block) from your server with your secret key (`cp_live_`, checked with the API as you
save it), and adds a postcode checker anywhere with `[clear_postcode_lookup]`. Tests: `wordpress/tests/run.sh` (a real
WordPress and WooCommerce in Docker, Plugin Check and PHPCS).

## Try it in Postman

Import [`postman/clear-postcode.postman_collection.json`](postman/clear-postcode.postman_collection.json), set the
`apiKey` variable (or leave it empty for keyless calls) and send any of the 18 ready-made requests, each with its
example answer. Rebuild it with `node postman/generate.mjs`.

## Working on this repository

- `node scripts/generate.mjs` writes both SDKs' types from `openapi/openapi.json`; `--update` refreshes the document
  from the live API first; `--check` (run by both test suites) fails when the types are behind.
- JavaScript: `cd npm && npm test` (mocked API), `npm run smoke` (every README block, live, keyless),
  `npm run check:package` (publint and attw).
- Python: `cd pypi && uv run pytest`, `uv run ruff check`, `uv run mypy`, `uv run python scripts/smoke.py` (live).
- WordPress: `wordpress/tests/run.sh`, then `wordpress/build-zip.sh` for the release asset.

## Plans

Free: 10,000 postcode lookups a month, no card. Paid plans for more ([plans](https://clearpostcode.co.uk/pricing)).
Not-found answers, autocomplete, address suggestions and `304 Not Modified` responses cost nothing.

## Licence

Code in this repository: MIT (the WordPress plugin: GPLv2 or later). Postcode data: Contains OS data © Crown copyright
and database right; Royal Mail data © Royal Mail copyright and database right; Office for National Statistics data
licensed under the Open Government Licence v3.0.
