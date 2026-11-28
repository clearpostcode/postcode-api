# What's new

## WordPress plugin 1.1.0 (28 November 2026)

- **The postcode finder at checkout:** postcodes formatted, suggested and checked as customers type, on the classic
  checkout, the Checkout block and My account addresses, with a clear message for a mistyped, retired or brand-new
  postcode. With a publishable key whose account has Address lookup, the same box finds the full address.
- **Contact Form 7 and WPForms:** a `[postcode* your-postcode]` tag and the `clear-postcode` CSS class give forms the
  finder and a postcode check on sending.
- **The postcode checker answers as visitors type**, straight from their browser, so it works behind page caches and
  costs your server nothing.
- **A Publishable key setting**, checked against your domain as you save; the secret key is never shown again once
  saved.

## JavaScript 2.1.1 (28 November 2026)

- The finder shows values in any element, not only form fields: put the council in a `<dd>` or a `<span>`.
- A publishable key the API refuses (not yet locked to the site's domain, or revoked) no longer stops the finder: it
  carries on keyless and says why in the console.
- A press on a button no longer moves it: the "full UK postcode" message from leaving the field waits until the press
  is released.

## JavaScript 2.1.0 (28 November 2026): the postcode finder

- **A postcode and address finder for any form, in one script tag.** As the customer types, it formats the postcode,
  suggests postcodes, checks the postcode and fills the council, county, constituency and more. A mistyped, retired or
  brand-new postcode gets a clear message, and a retired one offers its live replacement in one click.
- **Address lookup in the same box.** With a publishable key whose account has Address lookup, the customer types a
  postcode or the start of an address, picks it, and the address fields fill with Royal Mail's own lines.
- **Built for every shopper:** an ARIA combobox with full keyboard use and screen-reader announcements, a light theme
  you can restyle with CSS variables, no animation, and about 8 KB gzipped with no dependencies.
- **Anywhere you build:** `clearpostcode/widget` for bundlers, `<PostcodeFinder>` and `usePostcodeFinder()` in
  `clearpostcode/react`, and `dist/widget.js` with `dist/widget.css` to serve from your own domain or a CDN.

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
