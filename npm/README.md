# clearpostcode

Every UK postcode, answered in milliseconds: look up, validate and autocomplete postcodes, with the council, ward,
constituency, coordinates, police force, NHS area and deprivation decile behind each one. Find the nearest postcodes,
reverse geocode a point, measure distances, list a district, search places, and look up full Royal Mail addresses.

- **Typed end to end:** every answer and every error is typed, generated from the API's OpenAPI document.
- **Built for production:** automatic retries with backoff that honour `Retry-After` and the rate-limit headers,
  timeouts, cancellation, cursor pagination and bulk calls of any size.
- **Runs anywhere:** Node 20+, Bun, Deno, Cloudflare Workers and browsers. ESM and CommonJS. No dependencies.
- **A drop-in finder:** one script tag adds a postcode and address finder to any form, with a React component.
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
(`policy`, `limit`, `remaining`, `reset`). API parameters come first, then request options (`signal`, `timeout`,
`maxRetries`): `cp.postcodes.nearest("SW1A 1AA", { limit: 5 }, { timeout: 2_000 })`. Every field is documented at
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
| `RateLimitError` | 429 | `rate_limited`, `daily_cap_reached`, `suggestions_capped` |
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
console.log(data.valid, rateLimit !== null); // true true
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
joins the answers in the order you sent them. If a chunk fails part-way (the month's lookups run out, say), the error
carries `partial`: everything the chunks before it answered, so nothing you paid for is lost. Bulk calls are retried
only on answers that say nothing was billed (429 and 503).

## In the browser

`clearpostcode/browser` takes a publishable key (or none), refuses a secret key before any call, sends the key in the
URL so there is no CORS preflight, and offers only the calls a browser may make.

```js
import { ClearPostcode } from "clearpostcode/browser";

const cp = new ClearPostcode(); // or { key: "cp_pub_..." }: your publishable key, locked to your domain
const { data } = await cp.postcodes.autocomplete("M1 1");
console.log(data.length > 0); // true
```

## Postcode finder

A drop-in postcode (and address) finder for any form: about 8 KB gzipped, no dependencies, light theme, no animation.
As the customer types, it formats the postcode, suggests postcodes, checks the postcode and fills the fields the
postcode record holds: council, county, region, country, ward, constituency and coordinates. A mistyped, retired,
brand-new or Northern Ireland postcode gets a clear message, and a retired one offers its live replacement. It is an
ARIA combobox: arrow keys, Enter and Escape work, the focus stays visible and screen readers hear each suggestion and
result.

**One script tag.** Every input with `autocomplete="postal-code"` (or `data-clearpostcode="postcode"`) gets the finder,
including fields a checkout renders after the page loads.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/clearpostcode@2/dist/widget.css">
<script src="https://cdn.jsdelivr.net/npm/clearpostcode@2/dist/widget.js" data-key="cp_pub_..." defer></script>

<input name="postcode" autocomplete="postal-code">
<input name="council" data-clearpostcode="council">
```

Self-host it by serving `dist/widget.js` and `dist/widget.css` from your own domain. Script attributes: `data-key` (a
publishable key, optional in postcode mode), `data-mode` (`auto`, `postcode` or `address`), `data-selector` (which
inputs) and `data-auto="false"` (attach nothing; call `ClearPostcodeFinder.attach(input, options)` yourself).

**Address lookup.** With a publishable key whose account has Address lookup switched on, the same box takes a postcode
or the start of an address: the customer picks a street or building, then the address, and `address-line1`,
`address-line2`, `address-level2` (town), `postal-code` and `organization` fill. Without it the finder stays in
postcode mode on its own.

**Fields it fills.** Each field is found in the input's part of the form (so billing and shipping each fill their
own), by `data-clearpostcode="<name>"`, then by its autocomplete token:

| Name | From | Autocomplete token |
|---|---|---|
| `postcode` | the postcode, formatted | `postal-code` |
| `council`, `county`, `region`, `country`, `ward`, `constituency`, `latitude`, `longitude` | the postcode record | |
| `line1`, `line2`, `line3`, `lines`, `town`, `organisation`, `udprn` | the address (Address lookup) | `address-line1`, `address-line2`, `address-line3`, `street-address`, `address-level2`, `organization` |

It clears only what it filled itself, so a value the customer typed is never overwritten by an empty one.

**From code**, with your own wording and callbacks:

```js dom
import { attach } from "clearpostcode/widget";
import "clearpostcode/widget.css";

const finder = attach("#postcode", {
  key: "cp_pub_...",
  fields: { council: "#council", county: null },
  messages: { found: "{postcode} is in {council}" },
  onPostcode: (record) => console.log(record.local_authority?.name),
  onAddress: (address) => console.log(address.line_1, address.post_town),
});
```

**React:**

```jsx
import { PostcodeFinder } from "clearpostcode/react";
import "clearpostcode/widget.css";

<PostcodeFinder name="postcode" publishableKey="cp_pub_..." onAddress={(a) => setAddress(a)} />;
```

**Theme** it with CSS custom properties on any ancestor: `--cpw-accent`, `--cpw-text`, `--cpw-muted`, `--cpw-bg`,
`--cpw-border`, `--cpw-active-bg`, `--cpw-hover-bg`, `--cpw-ok`, `--cpw-warn`, `--cpw-error`, `--cpw-radius`,
`--cpw-shadow`, `--cpw-font-size` and `--cpw-z`. A demo that runs without a key:
[`examples/widget.html`](https://github.com/clearpostcode/postcode-api/blob/main/examples/widget.html).

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

// Suggestions are free (within a daily allowance per business). Kind "container" lists what it holds.
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
