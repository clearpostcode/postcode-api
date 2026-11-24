// ClearPostcode API client: UK postcode lookup, validation, autocomplete, nearest, reverse geocoding, distance and
// area data. No dependencies. Docs: https://clearpostcode.co.uk/developers/docs
export const BASE = "https://api.clearpostcode.co.uk/v1";

/** A non-2xx answer. `problem` is the RFC 9457 problem+json body; `request_id` is the id to quote to support. */
export class ClearPostcodeError extends Error {
  constructor(status, problem, request_id) {
    super(problem?.detail ?? problem?.title ?? `HTTP ${status}`);
    this.name = "ClearPostcodeError";
    this.status = status;
    this.problem = problem ?? {};
    this.request_id = request_id ?? this.problem.request_id;
  }
}

const seg = (s) => encodeURIComponent(String(s).trim());

export class ClearPostcode {
  /** @param {{ key?: string, base?: string, fetch?: typeof fetch, timeout?: number }} [opts] key: cp_live_ (secret) or cp_pub_ (publishable); most lookups also work without one. */
  constructor(opts = {}) {
    this.key = opts.key;
    this.base = opts.base ?? BASE;
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeout = opts.timeout ?? 20000;
  }

  async request(method, path, { query, body } = {}) {
    const q = query
      ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString()
      : "";
    const headers = { accept: "application/json" };
    if (this.key) headers["x-api-key"] = this.key;
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await this.fetch(`${this.base}${path}${q ? `?${q}` : ""}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: this.timeout ? AbortSignal.timeout(this.timeout) : undefined,
    });
    const text = await r.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    if (!r.ok) throw new ClearPostcodeError(r.status, json, r.headers?.get?.("x-request-id") ?? undefined);
    return json;
  }
  get(path, query) { return this.request("GET", path, { query }); }
  post(path, body, query) { return this.request("POST", path, { body, query }); }

  // Postcodes
  /** Everything about one postcode. opts.fields: comma-separated top-level fields to return. */
  lookup(postcode, opts = {}) { return this.get(`/postcodes/${seg(postcode)}`, { fields: opts.fields }); }
  /** Format valid? In the current edition? Live? */
  validate(postcode) { return this.get(`/postcodes/${seg(postcode)}/validate`); }
  /** Postcodes near a postcode. opts: { radius (metres, up to 2000), limit (1 to 50) } */
  nearest(postcode, opts = {}) { return this.get(`/postcodes/${seg(postcode)}/nearest`, { radius: opts.radius, limit: opts.limit }); }
  /** Postcodes near a point (reverse geocode). { lat, lon, radius?, limit? } */
  reverse({ lat, lon, radius, limit }) { return this.get("/postcodes", { lat, lon, radius, limit }); }
  /** Up to 100 postcodes in one call. Needs a secret key. */
  bulk(postcodes, opts = {}) { return this.post("/postcodes", { postcodes }, { fields: opts.fields }); }
  /** Up to 20 points in one call: [{ lat, lon, limit? }]. Needs a secret key. */
  bulkReverse(points) { return this.post("/reverse", { points }); }
  /** Complete a partial postcode. opts.limit: 1 to 20. */
  autocomplete(q, opts = {}) { return this.get("/autocomplete", { q, limit: opts.limit }); }
  /** Distance between two postcodes. */
  distance(from, to) { return this.get("/distance", { from, to }); }

  // Geography
  outcode(outcode) { return this.get(`/outcodes/${seg(outcode)}`); }
  /** Every postcode in a district, 100 a page. opts: { after (cursor: last postcode of the previous page), limit (1 to 500) }. Needs a secret key. */
  outcodePostcodes(outcode, opts = {}) { return this.get(`/outcodes/${seg(outcode)}/postcodes`, { after: opts.after, limit: opts.limit }); }
  sector(sector) { return this.get(`/sectors/${seg(sector)}`); }
  area(area) { return this.get(`/areas/${seg(area)}`); }

  // Places
  /** Find a place by name. opts.limit: 1 to 20. */
  places(q, opts = {}) { return this.get("/places", { q, limit: opts.limit }); }

  // Account
  /** Your month's usage. Needs a key. */
  usage() { return this.get("/usage"); }

  // Addresses (early access)
  addresses(postcode) { return this.get("/addresses", { postcode }); }
  addressSuggest(q) { return this.get("/addresses/suggest", { q }); }
  address(udprn) { return this.get(`/addresses/${seg(udprn)}`); }
}

export default ClearPostcode;
