import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ClearPostcode,
  VERSION,
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  ClearPostcodeError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  type OperationId,
} from "../src/index.ts";
import { ClearPostcode as BrowserClearPostcode } from "../src/browser.ts";
import { OPERATIONS } from "../src/generated.ts";
import { Transport, rateLimitOf } from "../src/http.ts";

type Doc = { paths: Record<string, Record<string, { operationId: string; responses: Record<string, { content?: Record<string, { example?: { data: unknown; meta: unknown } }> }> }>> };
const doc = JSON.parse(readFileSync(new URL("../../openapi/openapi.json", import.meta.url), "utf8")) as Doc;
const examples = new Map<string, { data: unknown; meta: unknown }>();
for (const methods of Object.values(doc.paths)) for (const op of Object.values(methods)) {
  const ex = op.responses["200"]?.content?.["application/json"]?.example;
  if (ex) examples.set(op.operationId, ex);
}
const META = examples.get("getPostcode")!.meta as Record<string, unknown>;

type Handler = (req: Request, n: number) => Response | Promise<Response>;
/** A fetch that records each request and answers from `handler`. */
function fake(handler: Handler) {
  const calls: Request[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    calls.push(req);
    return handler(req, calls.length);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": status < 300 ? "application/json" : "application/problem+json", "x-request-id": `req-${status}`, ...headers } });
const problem = (status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  json({ type: `https://clearpostcode.co.uk/developers/docs/errors#${code}`, title: code, status, detail: `Detail for ${code}.`, instance: "/v1/x", request_id: `rid-${code}`, ...extra }, status, headers);
const ok = (data: unknown, meta: Record<string, unknown> = {}) => json({ data, meta: { ...META, ...meta } });
const url = (r: Request) => new URL(r.url);
const client = (handler: Handler, extra: ConstructorParameters<typeof ClearPostcode>[0] = {}) => {
  const f = fake(handler);
  return { cp: new ClearPostcode({ key: null, fetch: f.fetch, ...extra }), calls: f.calls };
};

test("every operation in the OpenAPI document has a method that calls it, and answers its example", async () => {
  const calls: Record<OperationId, (cp: ClearPostcode) => Promise<{ data: unknown }>> = {
    getPostcode: (cp) => cp.postcodes.lookup("SW1A 1AA"),
    validatePostcode: (cp) => cp.postcodes.validate("sw1a1aa"),
    nearestToPostcode: (cp) => cp.postcodes.nearest("SW1A 1AA", { limit: 5 }),
    reverseGeocode: (cp) => cp.postcodes.reverse({ latitude: 51.501, longitude: -0.1416, limit: 3 }),
    bulkLookup: (cp) => cp.postcodes.bulk(["SW1A 1AA", "SW1A 9ZZ"]),
    bulkReverse: (cp) => cp.postcodes.bulkReverse([{ latitude: 51.5014, longitude: -0.1419 }]),
    autocomplete: (cp) => cp.postcodes.autocomplete("SW1A 1"),
    distance: (cp) => cp.postcodes.distance("SW1A 1AA", "EH1 1YZ"),
    getOutcode: (cp) => cp.outcodes.get("SW1A"),
    outcodePostcodes: (cp) => cp.outcodes.postcodes("SW1A", { limit: 100 }),
    getSector: (cp) => cp.sectors.get("SW1A 1"),
    getArea: (cp) => cp.areas.get("SW"),
    places: (cp) => cp.places.search("Chelsea"),
    usage: (cp) => cp.account.usage(),
    addressesByPostcode: (cp) => cp.addresses.byPostcode("AB10 1AA"),
    addressSuggest: (cp) => cp.addresses.suggest("2 high street porthmore"),
    addressRetrieve: (cp) => cp.addresses.retrieve("YR9BQjEwMUFBHzkwMDAwMDAxHw"),
    addressByUdprn: (cp) => cp.addresses.byUdprn("90000001"),
  };
  assert.deepEqual(Object.keys(calls).sort(), Object.keys(OPERATIONS).sort());
  for (const [id, call] of Object.entries(calls) as [OperationId, (cp: ClearPostcode) => Promise<{ data: unknown }>][]) {
    const op = OPERATIONS[id];
    const example = examples.get(id) ?? { data: [], meta: META }; // the address routes carry no example yet
    const { cp, calls: seen } = client(() => json(example));
    const r = await call(cp);
    assert.equal(seen.length, 1, id);
    const req = seen[0]!;
    assert.equal(req.method, op.method, id);
    const pattern = new RegExp(`^/v1${op.path.replace(/\{\w+\}/g, "[^/]+")}$`);
    assert.match(url(req).pathname, pattern, id);
    for (const k of url(req).searchParams.keys()) assert.ok((op.query as readonly string[]).includes(k), `${id} sent ${k}`);
    assert.deepEqual(r.data, example.data, id);
  }
});

test("path and query: postcodes are trimmed and encoded, fields are joined, unset options are left out", async () => {
  const { cp, calls } = client(() => ok({ postcode: "SW1A 1AA", status: "live" }));
  const r = await cp.postcodes.lookup(" SW1A 1AA ", { fields: ["location", "ward"] });
  assert.equal(url(calls[0]!).pathname, "/v1/postcodes/SW1A%201AA");
  assert.equal(url(calls[0]!).searchParams.get("fields"), "location,ward");
  assert.equal(r.data.postcode, "SW1A 1AA");
  // @ts-expect-error a lookup with fields answers only those fields, postcode and status
  void r.data.constituency;
  await cp.postcodes.nearest("SW1A 1AA");
  assert.equal(url(calls[1]!).search, "");
  await cp.postcodes.reverse({ latitude: 51.5, longitude: -0.12 });
  assert.equal(url(calls[2]!).search, "?lat=51.5&lon=-0.12");
});

test("the transport refuses a parameter the operation does not take", () => {
  const t = new Transport({ key: null, baseUrl: "https://x/v1", timeout: 1000, maxRetries: 0, maxRetryDelay: 0, fetch: globalThis.fetch, headers: {}, keyInQuery: false });
  assert.throws(() => t.url("outcodePostcodes", { path: { outcode: "SW1A" }, query: { after: "SW1A1AA" } }), /takes no "after" parameter/);
  assert.equal(t.url("outcodePostcodes", { path: { outcode: "SW1A" }, query: { cursor: "abc" } }), "https://x/v1/outcodes/SW1A/postcodes?cursor=abc");
});

test("keyless: no key header, the SDK's user agent, the request id and rate limits on the result", async () => {
  const { cp, calls } = client(() => ok({ postcode: "M1 1AE", status: "live" }, {}));
  const r = await cp.postcodes.lookup("M1 1AE");
  const h = calls[0]!.headers;
  assert.equal(h.get("x-api-key"), null);
  assert.equal(h.get("user-agent"), `clearpostcode-js/${VERSION} node/${process.versions.node}`);
  assert.equal(h.get("accept"), "application/json");
  assert.equal(r.requestId, "req-200");
  assert.equal(r.status, 200);
  assert.equal(url(calls[0]!).searchParams.get("key"), null);
});

test("the key: from options, else CLEAR_POSTCODE_KEY; key: null and an empty variable mean keyless", async () => {
  const key = `cp_live_${"a".repeat(32)}`;
  const f = fake(() => ok({}));
  await new ClearPostcode({ key, fetch: f.fetch }).postcodes.validate("M1 1AE");
  assert.equal(f.calls[0]!.headers.get("x-api-key"), key);
  assert.equal(url(f.calls[0]!).searchParams.get("key"), null, "a secret key never rides in the URL");
  process.env.CLEAR_POSTCODE_KEY = key;
  try {
    await new ClearPostcode({ fetch: f.fetch }).postcodes.validate("M1 1AE");
    assert.equal(f.calls[1]!.headers.get("x-api-key"), key);
    await new ClearPostcode({ key: null, fetch: f.fetch }).postcodes.validate("M1 1AE");
    assert.equal(f.calls[2]!.headers.get("x-api-key"), null);
    process.env.CLEAR_POSTCODE_KEY = "";
    await new ClearPostcode({ fetch: f.fetch }).postcodes.validate("M1 1AE");
    assert.equal(f.calls[3]!.headers.get("x-api-key"), null, "never the word undefined or an empty header");
  } finally {
    delete process.env.CLEAR_POSTCODE_KEY;
  }
});

test("errors are typed, carry the problem code, detail and request id, and are not retried when final", async () => {
  const { cp, calls } = client(() => problem(404, "postcode_not_found", { postcode: "SW1A 9ZZ" }));
  const e = await cp.postcodes.lookup("SW1A 9ZZ").catch((x: unknown) => x);
  assert.ok(e instanceof NotFoundError && e instanceof ClearPostcodeError);
  assert.equal(e.code, "postcode_not_found");
  assert.equal(e.status, 404);
  assert.equal(e.requestId, "rid-postcode_not_found");
  assert.equal(e.detail, "Detail for postcode_not_found.");
  assert.equal(e.problem.postcode, "SW1A 9ZZ");
  assert.equal(e.message, "404 postcode_not_found: Detail for postcode_not_found. (request rid-postcode_not_found)");
  assert.equal(calls.length, 1);

  const cases: [Response, typeof APIError, string | null][] = [
    [problem(400, "unknown_parameter", { parameters: ["after"], accepted: ["cursor", "limit", "key"] }), BadRequestError, "unknown_parameter"],
    [problem(401, "invalid_key"), AuthenticationError, "invalid_key"],
    [problem(403, "address_lookup_not_enabled", { setup: "https://clearpostcode.co.uk/dashboard#address-lookup" }), PermissionDeniedError, "address_lookup_not_enabled"],
    [new Response("<html>bad gateway</html>", { status: 502, headers: { "x-request-id": "edge-1" } }), InternalServerError, null],
  ];
  for (const [res, E, code] of cases) {
    const c = client(() => res.clone(), { maxRetries: 0 });
    const err = await c.cp.postcodes.validate("M1 1AE").catch((x: unknown) => x);
    assert.ok(err instanceof E, `${E.name}`);
    assert.equal((err as APIError).code, code);
  }
});

test("retries: 503 and 429 honour Retry-After, then succeed", async () => {
  const seq = [problem(503, "service_unavailable", {}, { "retry-after": "0" }), problem(429, "rate_limited", {}, { "retry-after": "0" }), ok({ valid: true })];
  const { cp, calls } = client((_, n) => seq[n - 1]!);
  const r = await cp.postcodes.validate("M1 1AE");
  assert.equal(calls.length, 3);
  assert.deepEqual(r.data, { valid: true });
});

test("retries: a Retry-After longer than maxRetryDelay is thrown at once, with retryAfter", async () => {
  const { cp, calls } = client(() => problem(429, "daily_cap_reached", {}, { "retry-after": "40000" }));
  const e = await cp.postcodes.validate("M1 1AE").catch((x: unknown) => x);
  assert.ok(e instanceof RateLimitError);
  assert.equal(e.retryAfter, 40000);
  assert.equal(calls.length, 1);
});

test("retries: a 429 without Retry-After waits for the RateLimit reset when nothing is left", async () => {
  const seq = [problem(429, "rate_limited", {}, { ratelimit: '"burst";r=0;t=0' }), ok({})];
  const { cp, calls } = client((_, n) => seq[n - 1]!);
  await cp.postcodes.validate("M1 1AE");
  assert.equal(calls.length, 2);
});

test("retries: none for 4xx answers, none with maxRetries 0, and at most maxRetries", async () => {
  const a = client(() => problem(400, "invalid_postcode"));
  await assert.rejects(a.cp.postcodes.validate("x"), BadRequestError);
  assert.equal(a.calls.length, 1);
  const b = client(() => problem(503, "service_unavailable", {}, { "retry-after": "0" }), { maxRetries: 0 });
  await assert.rejects(b.cp.postcodes.validate("M1 1AE"), InternalServerError);
  assert.equal(b.calls.length, 1);
  const c = client(() => problem(500, "server_error", {}, { "retry-after": "0" }), { maxRetries: 3 });
  await assert.rejects(c.cp.postcodes.validate("M1 1AE"), InternalServerError);
  assert.equal(c.calls.length, 4);
});

test("a dropped connection is retried with backoff, then thrown as APIConnectionError", async () => {
  const { cp, calls } = client(() => {
    throw new TypeError("fetch failed");
  }, { maxRetries: 1 });
  const e = await cp.postcodes.validate("M1 1AE").catch((x: unknown) => x);
  assert.ok(e instanceof APIConnectionError && !(e instanceof APITimeoutError));
  assert.ok(e.cause instanceof TypeError);
  assert.equal(calls.length, 2);
});

test("a timeout is an APITimeoutError; the caller's AbortSignal cancels without a retry", async () => {
  const hang: Handler = (req) => new Promise((_, reject) => req.signal.addEventListener("abort", () => reject(req.signal.reason)));
  const t = client(hang, { timeout: 30, maxRetries: 0 });
  await assert.rejects(t.cp.postcodes.validate("M1 1AE"), APITimeoutError);
  const u = client(hang, { maxRetries: 3 });
  const ctl = new AbortController();
  const p = u.cp.postcodes.validate("M1 1AE", { signal: ctl.signal });
  ctl.abort(new Error("user left"));
  await assert.rejects(p, /user left/);
  assert.equal(u.calls.length, 1);
});

test("rate limits: the three-field headers, the policy name, and gaps filled from RateLimit and RateLimit-Policy", () => {
  const full = new Headers({ ratelimit: '"month";r=9588;t=1814400', "ratelimit-policy": '"burst";q=100;w=10, "month";q=10000;w=2592000', "ratelimit-limit": "10000", "ratelimit-remaining": "9588", "ratelimit-reset": "1814400" });
  assert.deepEqual(rateLimitOf(full), { policy: "month", limit: 10000, remaining: 9588, reset: 1814400 });
  const structured = new Headers({ ratelimit: '"day";r=1990;t=3600', "ratelimit-policy": '"minute";q=30;w=60, "day";q=2000;w=86400' });
  assert.deepEqual(rateLimitOf(structured), { policy: "day", limit: 2000, remaining: 1990, reset: 3600 });
  assert.equal(rateLimitOf(new Headers()), null);
});

test("cursor pagination: pages follow meta.next_cursor as cursor=, and the iterator walks every page", async () => {
  const pages: Record<string, { data: unknown[]; next: string | null }> = {
    "": { data: [{ postcode: "SW1A 0AA" }, { postcode: "SW1A 0PW" }], next: "c1" },
    c1: { data: [{ postcode: "SW1A 1AA" }], next: "c2" },
    c2: { data: [{ postcode: "SW1A 2AA" }], next: null },
  };
  const { cp, calls } = client((req) => {
    const p = pages[url(req).searchParams.get("cursor") ?? ""]!;
    return ok(p.data, { total: 4, next_cursor: p.next });
  });
  const first = await cp.outcodes.postcodes("SW1A", { limit: 2 });
  assert.equal(first.nextCursor, "c1");
  assert.equal(first.hasMore, true);
  const second = await first.next();
  assert.equal(url(calls[1]!).searchParams.get("cursor"), "c1");
  assert.equal(url(calls[1]!).searchParams.get("limit"), "2");
  assert.equal(url(calls[1]!).searchParams.get("after"), null);
  assert.deepEqual(second?.data, [{ postcode: "SW1A 1AA" }]);
  const all: string[] = [];
  for await (const pc of cp.outcodes.allPostcodes("SW1A")) all.push(pc.postcode);
  assert.deepEqual(all, ["SW1A 0AA", "SW1A 0PW", "SW1A 1AA", "SW1A 2AA"]);
  const last = await (await second!.next())!.next();
  assert.equal(last, null);
});

test("bulk: any number of postcodes, 100 a call, joined in order with sent and found added up", async () => {
  const list = Array.from({ length: 250 }, (_, i) => `PC${i}`);
  const { cp, calls } = client(async (req) => {
    const body = (await req.json()) as { postcodes: string[] };
    return ok(body.postcodes.map((q) => ({ query: q, result: null, error: "postcode_not_found" })), { sent: body.postcodes.length, found: 0 });
  }, { key: `cp_live_${"b".repeat(32)}` });
  const r = await cp.postcodes.bulk(list, { fields: ["ward"] });
  assert.deepEqual(calls.map((c) => c.method), ["POST", "POST", "POST"]);
  assert.equal(calls[0]!.headers.get("content-type"), "application/json");
  assert.equal(url(calls[0]!).searchParams.get("fields"), "ward");
  assert.deepEqual(r.data.map((x) => x.query), list);
  assert.equal(r.meta?.sent, 250);
  assert.equal(r.requestIds.length, 3);
  const empty = await cp.postcodes.bulk([]);
  assert.equal(calls.length, 3, "an empty list makes no call");
  assert.deepEqual(empty.data, []);
});

test("bulk reverse: 20 points a call, latitude and longitude sent as lat and lon", async () => {
  const points = Array.from({ length: 45 }, (_, i) => ({ latitude: 51 + i / 100, longitude: -0.1, limit: 1 }));
  const sizes: number[] = [];
  const { cp } = client(async (req) => {
    const body = (await req.json()) as { points: { lat: number; lon: number; limit: number }[] };
    sizes.push(body.points.length);
    assert.equal(body.points[0]!.lon, -0.1);
    return ok(body.points.map((p) => ({ query: { latitude: p.lat, longitude: p.lon }, result: [] })));
  });
  const r = await cp.postcodes.bulkReverse(points);
  assert.deepEqual(sizes, [20, 20, 5]);
  assert.equal(r.data.length, 45);
  assert.equal(r.data[44]!.query.latitude, 51.44);
});

test("address lookup: suggestions with containers, retrieve by id, by UDPRN, and a postcode's list by cursor", async () => {
  const { cp, calls } = client((req) => {
    const u = url(req);
    if (u.pathname === "/v1/addresses") return ok([{ udprn: "1" }], { next_cursor: u.searchParams.get("cursor") ? null : "p2" });
    return ok([]);
  });
  await cp.addresses.suggest("", { container: "c-123", limit: 20 });
  assert.equal(url(calls[0]!).pathname, "/v1/addresses/suggest");
  assert.equal(url(calls[0]!).search, "?container=c-123&limit=20");
  await cp.addresses.retrieve("YR9BQ/x");
  assert.equal(url(calls[1]!).pathname, "/v1/addresses/retrieve/YR9BQ%2Fx");
  await cp.addresses.byUdprn(90000001);
  assert.equal(url(calls[2]!).pathname, "/v1/addresses/90000001");
  const all = [];
  for await (const a of cp.addresses.allByPostcode("AB10 1AA")) all.push(a);
  assert.equal(all.length, 2);
  assert.equal(url(calls[4]!).search, "?postcode=AB10+1AA&cursor=p2");
});

test("browser client: publishable keys only, sent as ?key= with no custom headers; only browser calls", async () => {
  assert.throws(() => new BrowserClearPostcode({ key: `cp_live_${"c".repeat(32)}` }), /stay on your server/);
  assert.throws(() => new BrowserClearPostcode({ key: "sk_test_123" }), /start cp_pub_/);
  const f = fake(() => ok({}));
  const pub = `cp_pub_${"d".repeat(32)}`;
  const b = new BrowserClearPostcode({ key: pub, fetch: f.fetch });
  await b.postcodes.autocomplete("SW1A");
  const req = f.calls[0]!;
  assert.equal(url(req).searchParams.get("key"), pub);
  assert.equal(req.headers.get("x-api-key"), null);
  assert.equal(req.headers.get("user-agent"), null);
  assert.deepEqual([...req.headers.keys()], ["accept"]);
  // @ts-expect-error bulk calls need a secret key, so the browser client has none
  void b.postcodes.bulk;
  // @ts-expect-error a district's full list needs a secret key
  void b.outcodes.postcodes;
  await new BrowserClearPostcode({ fetch: f.fetch }).postcodes.validate("M1 1AE");
  assert.equal(url(f.calls[1]!).search, "", "keyless: no key at all");
});

test("the universal client refuses a secret key on a web page", () => {
  const g = globalThis as { document?: unknown };
  g.document = {};
  try {
    assert.throws(() => new ClearPostcode({ key: `cp_live_${"e".repeat(32)}` }), ClearPostcodeError);
    const f = fake(() => ok({}));
    new ClearPostcode({ key: `cp_pub_${"f".repeat(32)}`, fetch: f.fetch });
  } finally {
    delete g.document;
  }
});

test("an empty postcode, id or district is refused before any call", async () => {
  const { cp, calls } = client(() => ok({}));
  await assert.rejects(cp.postcodes.lookup(""), /getPostcode needs a postcode/);
  await assert.rejects(cp.postcodes.validate("  "), TypeError);
  await assert.rejects(cp.addresses.retrieve(""), /addressRetrieve needs a id/);
  assert.equal(calls.length, 0);
});

test("fields: an empty list asks for the full record, as in Python", async () => {
  const { cp, calls } = client(() => ok({ postcode: "M1 1AE", status: "live" }));
  await cp.postcodes.lookup("M1 1AE", { fields: [] });
  assert.equal(url(calls[0]!).search, "");
});

test("a bulk POST is never retried after a dropped connection or a 500, only on 429 and 503", async () => {
  const body = { postcodes: ["M1 1AE"] };
  const drop = client(() => {
    throw new TypeError("socket hang up");
  }, { maxRetries: 3 });
  await assert.rejects(drop.cp.postcodes.bulk(body.postcodes), APIConnectionError);
  assert.equal(drop.calls.length, 1);
  const fail = client(() => problem(500, "server_error"), { maxRetries: 3 });
  await assert.rejects(fail.cp.postcodes.bulk(body.postcodes), InternalServerError);
  assert.equal(fail.calls.length, 1);
  const seq = [problem(503, "service_unavailable", {}, { "retry-after": "0" }), ok([{ query: "M1 1AE", result: null }])];
  const busy = client((_, n) => seq[n - 1]!);
  await busy.cp.postcodes.bulk(body.postcodes);
  assert.equal(busy.calls.length, 2);
});

test("a bulk call that fails part-way throws with the chunks already answered", async () => {
  const { cp, calls } = client(async (req, n) => {
    if (n === 2) return problem(402, "quota_exceeded");
    const sent = ((await req.json()) as { postcodes: string[] }).postcodes;
    return ok(sent.map((q) => ({ query: q, result: { postcode: q, status: "live" } })), { sent: sent.length, found: sent.length });
  });
  const e = await cp.postcodes.bulk(Array.from({ length: 150 }, (_, i) => `PC${i}`)).catch((x: unknown) => x);
  assert.ok(e instanceof APIError && e.code === "quota_exceeded");
  assert.equal(e.partial?.data.length, 100);
  assert.equal(e.partial?.meta?.found, 100);
  assert.equal(calls.length, 2);
});

test("bulk reverse counts the points that found postcodes", async () => {
  const { cp } = client(() => ok([{ query: { latitude: 1, longitude: 1 }, result: [{ postcode: "X" }] }, { query: { latitude: 2, longitude: 2 }, result: [] }]));
  const r = await cp.postcodes.bulkReverse([{ latitude: 1, longitude: 1 }, { latitude: 2, longitude: 2 }]);
  assert.equal(r.meta?.found, 1);
});

test("iterators fetch nothing until read; a backoff never waits past maxRetryDelay", async () => {
  const { cp, calls } = client(() => ok([], { next_cursor: null }));
  const it = cp.outcodes.allPostcodes("SW1A");
  const all = cp.addresses.allByPostcode("AB10 1AA");
  assert.equal(calls.length, 0);
  for await (const _ of it) void _;
  for await (const _ of all) void _;
  assert.equal(calls.length, 2);
  const slow = client(() => problem(503, "service_unavailable"), { maxRetries: 2, maxRetryDelay: 20 });
  const t0 = Date.now();
  await assert.rejects(slow.cp.postcodes.validate("M1 1AE"), InternalServerError);
  assert.ok(Date.now() - t0 < 300, `waited ${Date.now() - t0} ms`);
});

test("redirects are never followed with the key; unknown problem codes come through", async () => {
  const { cp, calls } = client(() => problem(400, "a_code_from_next_year"));
  const e = await cp.postcodes.validate("M1 1AE").catch((x: unknown) => x);
  assert.equal(calls[0]!.redirect, "error");
  assert.ok(e instanceof BadRequestError && e.code === "a_code_from_next_year");
});

test("a web worker counts as a browser: a secret key is refused there", () => {
  const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0" }, configurable: true });
  try {
    assert.throws(() => new ClearPostcode({ key: `cp_live_${"g".repeat(32)}` }), /stay on your server/);
  } finally {
    if (nav) Object.defineProperty(globalThis, "navigator", nav);
  }
});

test("VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(VERSION, pkg.version);
});
