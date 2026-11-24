import { test } from "node:test";
import assert from "node:assert/strict";
import { ClearPostcode, ClearPostcodeError, BASE } from "./index.js";

function mock(status, body, headers = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json", ...headers },
    });
  };
  return { fetch, calls };
}

test("lookup encodes the postcode and sends no key header when keyless", async () => {
  const m = mock(200, { data: { postcode: "SW1A 1AA" }, meta: {} });
  const r = await new ClearPostcode({ fetch: m.fetch }).lookup("SW1A 1AA", { fields: "location,ward" });
  assert.equal(r.data.postcode, "SW1A 1AA");
  assert.equal(m.calls[0].url, `${BASE}/postcodes/SW1A%201AA?fields=location%2Cward`);
  assert.equal(m.calls[0].init.headers["x-api-key"], undefined);
});

test("key goes in x-api-key", async () => {
  const m = mock(200, { data: {}, meta: {} });
  await new ClearPostcode({ key: "cp_pub_abc", fetch: m.fetch }).validate("m1 1ae");
  assert.equal(m.calls[0].init.headers["x-api-key"], "cp_pub_abc");
  assert.equal(m.calls[0].url, `${BASE}/postcodes/m1%201ae/validate`);
});

test("query: undefined values are dropped", async () => {
  const m = mock(200, { data: [], meta: {} });
  const c = new ClearPostcode({ fetch: m.fetch });
  await c.nearest("SW1A 1AA", { limit: 3 });
  await c.reverse({ lat: 51.501, lon: -0.1416 });
  await c.autocomplete("SW1A 1", { limit: 2 });
  await c.distance("SW1A 1AA", "M1 1AE");
  await c.places("Leeds");
  assert.equal(m.calls[0].url, `${BASE}/postcodes/SW1A%201AA/nearest?limit=3`);
  assert.equal(m.calls[1].url, `${BASE}/postcodes?lat=51.501&lon=-0.1416`);
  assert.equal(m.calls[2].url, `${BASE}/autocomplete?q=SW1A+1&limit=2`);
  assert.equal(m.calls[3].url, `${BASE}/distance?from=SW1A+1AA&to=M1+1AE`);
  assert.equal(m.calls[4].url, `${BASE}/places?q=Leeds`);
});

test("geography paths", async () => {
  const m = mock(200, { data: {}, meta: {} });
  const c = new ClearPostcode({ fetch: m.fetch });
  await c.outcode("SW1A");
  await c.outcodePostcodes("SW1A", { after: "SW1A 2AA", limit: 50 });
  await c.sector("SW1A 1");
  await c.area("SW");
  await c.usage();
  await c.addresses("SW1A 1AA");
  await c.address(123);
  assert.deepEqual(
    m.calls.map((x) => x.url.slice(BASE.length)),
    ["/outcodes/SW1A", "/outcodes/SW1A/postcodes?after=SW1A+2AA&limit=50", "/sectors/SW1A%201", "/areas/SW", "/usage", "/addresses?postcode=SW1A+1AA", "/addresses/123"],
  );
});

test("bulk and bulkReverse post JSON", async () => {
  const m = mock(200, { data: [], meta: {} });
  const c = new ClearPostcode({ key: "cp_live_x", fetch: m.fetch });
  await c.bulk(["SW1A 1AA", "M1 1AE"], { fields: "location" });
  await c.bulkReverse([{ lat: 51.5, lon: -0.14, limit: 1 }]);
  assert.equal(m.calls[0].init.method, "POST");
  assert.equal(m.calls[0].url, `${BASE}/postcodes?fields=location`);
  assert.deepEqual(JSON.parse(m.calls[0].init.body), { postcodes: ["SW1A 1AA", "M1 1AE"] });
  assert.equal(m.calls[0].init.headers["content-type"], "application/json");
  assert.equal(m.calls[1].url, `${BASE}/reverse`);
  assert.deepEqual(JSON.parse(m.calls[1].init.body), { points: [{ lat: 51.5, lon: -0.14, limit: 1 }] });
});

test("errors carry status, problem and request_id", async () => {
  const problem = { type: "https://clearpostcode.co.uk/developers/docs/errors#invalid_postcode", title: "That is not a UK postcode", status: 400, detail: '"ZZ" is not in the format of a UK postcode.', request_id: "abc123" };
  const m = mock(400, problem);
  await assert.rejects(new ClearPostcode({ fetch: m.fetch }).lookup("ZZ"), (e) => {
    assert.ok(e instanceof ClearPostcodeError);
    assert.equal(e.status, 400);
    assert.deepEqual(e.problem, problem);
    assert.equal(e.request_id, "abc123");
    assert.match(e.message, /not in the format/);
    return true;
  });
});

test("request_id falls back to the header; non-JSON errors still throw typed", async () => {
  const m = mock(502, "<html>bad gateway</html>", { "x-request-id": "hdr-1" });
  await assert.rejects(new ClearPostcode({ fetch: m.fetch }).usage(), (e) => {
    assert.ok(e instanceof ClearPostcodeError);
    assert.equal(e.status, 502);
    assert.equal(e.request_id, "hdr-1");
    assert.deepEqual(e.problem, {});
    return true;
  });
});
