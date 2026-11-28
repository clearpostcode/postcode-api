# clearpostcode

Every UK postcode, answered in milliseconds: look up, validate and autocomplete postcodes, with the council, ward,
constituency, coordinates, police force, NHS area and deprivation decile behind each one. Find the nearest postcodes,
reverse geocode a point, measure distances, list a district, search places, and look up full Royal Mail addresses.

- **Typed end to end:** every answer and every error is typed, generated from the API's OpenAPI document.
- **Built for production:** automatic retries with backoff that honour `Retry-After` and the rate-limit headers,
  timeouts, cancellation, cursor pagination and bulk calls of any size.
- **Runs anywhere:** Node 20+, Bun, Deno, Cloudflare Workers and browsers. ESM and CommonJS. No dependencies.
- **Free to start:** 10,000 postcode lookups a month on a free key, no card, and many calls work with no key at all.

Two products, one key: **Postcode data** (every UK postcode and its areas, from open data) and **Address lookup**
(every address at a postcode, from Royal Mail PAF).

## Install

```sh
npm install clearpostcode
```

## Quickstart

Runs as printed, with or without a key. The client reads your key from `CLEAR_POSTCODE_KEY` when it is set; without
one, calls run on the free keyless allowance.

```js
import { ClearPostcode } from "clearpostcode";

const cp = new ClearPostcode();

const { data } = await cp.postcodes.lookup("SW1A 1AA");
console.log(data.local_authority?.name, data.constituency?.name);
// Westminster Cities of London and Westminster

const { data: check } = await cp.postcodes.validate("m1 1ae");
console.log(check.valid, check.postcode); // true M1 1AE

const { data: suggestions } = await cp.postcodes.autocomplete("SW1A 1");
console.log(suggestions.length > 0); // true
```

Get a free key in under a minute at [clearpostcode.co.uk/developers](https://clearpostcode.co.uk/developers#key).
Secret keys (`cp_live_`) are for servers; publishable keys (`cp_pub_`) are locked to your domains and safe in a
browser.

```sh
export CLEAR_POSTCODE_KEY=cp_live_...
```

## What you can call

| Call | What it answers |
|---|---|
| `postcodes.lookup(postcode, { fields })` | The full record: status, coordinates, council, ward, constituency and every other area |
| `postcodes.validate(postcode)` | Is the format valid, is it in the current edition, is it live |
| `postcodes.autocomplete(q, { limit })` | Postcodes (or districts) that start with what was typed. Free |
| `postcodes.nearest(postcode, { radius, limit })` | Live postcodes nearest a postcode, with distances |
| `postcodes.reverse({ latitude, longitude, radius, limit })` | Live postcodes nearest a point |
| `postcodes.distance(from, to)` | Kilometres, miles and the bearing between two postcodes |
| `postcodes.bulk(postcodes, { fields })` | Any number of postcodes, sent 100 a call. Secret key |
| `postcodes.bulkReverse(points)` | Nearest postcodes for any number of points, 20 a call. Secret key |
| `outcodes.get(outcode)` | A district: counts, sectors, centre, councils, wards, places |
| `outcodes.postcodes(outcode)` / `outcodes.allPostcodes(outcode)` | Every live postcode in a district, by page or all of them. Secret key |
| `sectors.get(sector)` · `areas.get(area)` | A sector or an area |
| `places.search(q)` | Cities, towns, villages and neighbourhoods by name |
| `account.usage()` | Your plan, allowance, lookups used and reset date. Secret key |
| `addresses.suggest`, `retrieve`, `byPostcode`, `allByPostcode`, `byUdprn` | Address lookup (below) |

Every call answers a `Result`: `data` and `meta` as the API sends them, plus `status`, `requestId` and `rateLimit`
(`policy`, `limit`, `remaining`, `reset`). Every field is documented at
[clearpostcode.co.uk/developers/docs](https://clearpostcode.co.uk/developers/docs).

Ask only for the fields you need, and the types follow:

```js
import { ClearPostcode } from "clearpostcode";

const cp = new ClearPostcode();
const { data } = await cp.postcodes.lookup("EH1 1YZ", { fields: ["location", "ward"] });
console.log(data.postcode, data.ward?.name, data.location.latitude); // EH1 1YZ City Centre 55.950328
```

## Errors

Every error is a `ClearPostcodeError`. When the API answers with an error, you get an `APIError` subclass carrying
the problem's `code`, `detail`, `status` and the `requestId` to quote to support:

```js
import { ClearPostcode, NotFoundError } from "clearpostcode";

const cp = new ClearPostcode();
try {
  await cp.postcodes.lookup("SW1A 9ZZ");
} catch (err) {
  if (!(err instanceof NotFoundError)) throw err;
  console.log(err.code); // postcode_not_found
}
```

| Class | Status | Codes |
|---|---|---|
| `BadRequestError` | 400, 413 | `invalid_postcode`, `unknown_parameter`, `bad_request`, `secret_key_in_url`, `body_too_large` |
| `AuthenticationError` | 401 | `invalid_key`, `key_required` |
| `QuotaExceededError` | 402 | `quota_exceeded`, `address_credits_exhausted` |
| `PermissionDeniedError` | 403 | `origin_not_allowed`, `publishable_key_not_allowed`, `secret_key_in_browser`, `address_lookup_not_enabled` |
| `NotFoundError` | 404 | `postcode_not_found`, `not_covered`, `not_found` |
| `UnprocessableEntityError` | 422 | `no_position` |
| `RateLimitError` | 429 | `rate_limited`, `daily_cap_reached` |
| `InternalServerError` | 5xx | `server_error`, `service_unavailable` |
| `APIConnectionError`, `APITimeoutError` | | The API could not be reached, or did not answer in time |

## Retries, timeouts and cancellation

429s, 5xx answers, timeouts and dropped connections are retried twice by default, with exponential backoff and
jitter. A `Retry-After` from the API is honoured exactly, and a 429 without one waits for the `RateLimit` reset. A
wait longer than `maxRetryDelay` (a key's daily cap until midnight, say) is thrown to you at once, with `retryAfter`
in seconds.

```js
import { ClearPostcode } from "clearpostcode";

const cp = new ClearPostcode({ timeout: 5_000, maxRetries: 3 });
const { data, rateLimit } = await cp.postcodes.validate("SW1A 1AA", { signal: AbortSignal.timeout(8_000) });
console.log(data.valid, rateLimit?.policy); // true day
```

## Pages and bulk calls

```js secret
import { ClearPostcode } from "clearpostcode";

const cp = new ClearPostcode(); // a secret key in CLEAR_POSTCODE_KEY

let count = 0;
for await (const pc of cp.outcodes.allPostcodes("SW1A")) count++;
console.log(count > 100); // true: every live postcode in SW1A, page after page

const { data, meta } = await cp.postcodes.bulk(["SW1A 1AA", "M1 1AE", "EH1 1YZ"], { fields: ["local_authority"] });
console.log(meta?.found, data[1]?.result?.local_authority?.name); // 3 Manchester
```

Bulk calls take lists of any length: the client sends 100 postcodes (or 20 points) a call, one after another, and
joins the answers in the order you sent them.

## In the browser

`clearpostcode/browser` takes a publishable key (or none), refuses a secret key before any call, sends the key in the
URL so there is no CORS preflight, and offers only the calls a browser may make.

```js
import { ClearPostcode } from "clearpostcode/browser";

const cp = new ClearPostcode(); // or { key: "cp_pub_..." }: your publishable key, locked to your domain
const { data } = await cp.postcodes.autocomplete("M1 1");
console.log(data.length > 0); // true
```

## Address lookup

Full UK address lookup on Royal Mail's Postcode Address File: the customer types a postcode or the start of an
address, picks it from the list, and you save a clean Royal Mail address. It is in early access and switches on per
account: once the business your key serves has Address lookup switched on in your
[dashboard](https://clearpostcode.co.uk/dashboard#address-lookup), every call below answers. Until then they answer
`PermissionDeniedError` with code `address_lookup_not_enabled`. Join at
[clearpostcode.co.uk/address-lookup](https://clearpostcode.co.uk/address-lookup).

```js secret
import { ClearPostcode } from "clearpostcode";

const cp = new ClearPostcode();

// Suggestions are free. Kind "container" (a postcode, street or building) lists what it holds.
const { data: found } = await cp.addresses.suggest("2 high street porthmore");
const first = found[0];
const pick = first?.kind === "container" ? (await cp.addresses.suggest("", { container: first.id })).data[0] : first;

// Resolving an address costs one address credit.
if (pick?.kind === "address") {
  const { data: address } = await cp.addresses.retrieve(pick.id);
  console.log(address.line_1, address.post_town, address.postcode);
}

// Every address at a postcode, 100 a page.
for await (const a of cp.addresses.allByPostcode("AB10 1AA")) console.log(a.udprn, a.line_1);
```

## CommonJS

```js cjs
const { ClearPostcode } = require("clearpostcode");

new ClearPostcode().postcodes.lookup("M1 1AE").then(({ data }) => console.log(data.local_authority?.name)); // Manchester
```

## Plans

Free: 10,000 postcode lookups a month, no card. Not-found answers, autocomplete and address suggestions cost nothing.
More lookups and Address lookup: [clearpostcode.co.uk/pricing](https://clearpostcode.co.uk/pricing). What's new:
[CHANGELOG](https://github.com/clearpostcode/postcode-api/blob/main/CHANGELOG.md).

## Licence

MIT. Postcode data: Contains OS data © Crown copyright and database right; Royal Mail data © Royal Mail copyright and
database right; Office for National Statistics data licensed under the Open Government Licence v3.0.
