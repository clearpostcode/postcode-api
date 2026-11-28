# What's new

## SDKs 2.0.0 (28 November 2026): npm and PyPI

The ClearPostcode SDKs, rebuilt to the standard of the best API clients, on the API's tightened contract.

- **Typed end to end.** Every answer and every error is typed from the API's own OpenAPI document: TypeScript
  interfaces in JavaScript, `TypedDict`s in Python. Ask a lookup for a few `fields` and the TypeScript type narrows to
  them.
- **Errors you can act on.** One class per kind of answer (`NotFoundError`, `RateLimitError`, `AuthenticationError`
  and the rest), each carrying the problem `code`, `detail` and the `request_id` to quote to support.
- **Retries built in.** 429s, 5xx answers, timeouts and dropped connections are retried with backoff, honouring
  `Retry-After` and the `RateLimit` headers. Every result carries its rate-limit state.
- **Pages and bulk calls without the bookkeeping.** Iterate every postcode in a district, or every address at a
  postcode, with one loop. Bulk lookups take lists of any length and send them 100 at a time.
- **Address lookup.** Full Royal Mail addresses: suggestions as the customer types (with postcode, street and building
  containers), retrieve, every address at a postcode, and lookup by UDPRN. Early access, switched on per account.
- **JavaScript:** ESM and CommonJS, Node 20+, Bun, Deno and Workers, no dependencies, and `clearpostcode/browser` for
  web pages, which takes publishable keys only and sends no preflight.
- **Python:** sync `ClearPostcode` and async `AsyncClearPostcode` on httpx, Python 3.11 and later.

Moving from 1.x: calls now sit under resources (`cp.postcodes.lookup()` for `cp.lookup()`, `cp.outcodes.get()` for
`cp.outcode()`, `cp.places.search()` for `cp.places()`, `cp.account.usage()` for `cp.usage()`); every call answers a
result with `data` and `meta`; districts and areas answer in snake_case (`area_name`, `centre.latitude`); pages follow
`cursor` and `meta.next_cursor`; reverse geocoding takes `latitude` and `longitude`. The client reads your key from
`CLEAR_POSTCODE_KEY`.

## WordPress plugin 1.0.1 (28 November 2026)

- Settings take your secret key (`cp_live_`), the right key for checks that run on your server, and confirm it with
  the API as you save, showing your plan and lookups left.
- A notice on your dashboard when the API refuses the key, the month's lookups are used up or today's allowance is
  reached, with what to do.
- Clearer checkout messages: a retired postcode names the live postcode that replaced it.

## 1.0.0 (24 November 2026)

The first SDKs on npm and PyPI, the WordPress and WooCommerce plugin and the Postman collection.
