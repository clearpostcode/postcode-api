import { BASE_URL, type Area, type BulkItem, type Distance, type District, type Meta, type Near, type OutcodePostcode, type Place, type Postcode, type ReverseItem, type Sector, type Suggestion, type Usage, type Validation } from "./generated.ts";
import { type RateLimit, type RequestOptions, type Result, Transport, type TransportConfig } from "./http.ts";
import { type Page, pageOf, every } from "./page.ts";
import { Addresses } from "./addresses.ts";
import { ClearPostcodeError } from "./errors.ts";

/** Options for a client. */
export interface ClientOptions {
  /** Your key: cp_live_ (secret, servers) or cp_pub_ (publishable, browsers). Postcode lookups, validation,
   *  autocomplete and more also work without one, on the free keyless allowance. */
  key?: string | null;
  /** The API's base URL (default https://api.clearpostcode.co.uk/v1). */
  baseUrl?: string;
  /** Milliseconds to wait for each attempt (default 10,000). */
  timeout?: number;
  /** Retries after a 429, a 5xx, a timeout or a dropped connection (default 2). */
  maxRetries?: number;
  /** The longest Retry-After the client waits out, in milliseconds (default 60,000); a longer one is thrown at once. */
  maxRetryDelay?: number;
  /** A fetch to use instead of the global one. */
  fetch?: typeof fetch;
}

/** A full postcode record: every field, as a lookup without `fields` answers. */
export type PostcodeRecord = Required<Postcode>;
/** A field to ask for with `fields` (postcode and status always come back). */
export type PostcodeField = Exclude<keyof Postcode, "postcode" | "status">;
/** The record a lookup with `fields` answers. */
export type PostcodeWith<F extends PostcodeField> = Pick<PostcodeRecord, F | "postcode" | "status">;
/** A bulk lookup's item, its record trimmed to the fields asked for. */
export type BulkLookupItem<R> = Omit<BulkItem, "result"> & { result: R | null };
/** A point for reverse geocoding. */
export interface ReversePoint {
  latitude: number;
  longitude: number;
  /** Search radius in metres (default 500). */
  radius?: number;
  /** How many postcodes for this point (1 to 10, default 1). */
  limit?: number;
}

/** A bulk call's answer, sent in chunks the API takes (100 postcodes, 20 points) and joined in the order sent. */
export interface BulkResult<T> {
  readonly data: T[];
  /** The last chunk's meta, with `sent` and `found` added up over every chunk. Null for an empty list. A chunk that
   *  fails throws its error with `partial` holding what the chunks before it answered. */
  readonly meta: Meta | null;
  /** One id per chunk. */
  readonly requestIds: (string | null)[];
  readonly rateLimit: RateLimit | null;
}

export const BULK_POSTCODES = 100;
export const BULK_POINTS = 20;

/** Did an item find anything: a bulk lookup's record, a bulk reverse point's postcodes. */
const found = (item: { result: unknown }) => (Array.isArray(item.result) ? item.result.length > 0 : item.result !== null);

/** Send `items` in chunks of `size`, one after another, and join the answers. A chunk that fails throws its error
 *  with `partial` holding the chunks already answered (and billed). */
async function chunked<T, R extends { result: unknown }>(items: readonly T[], size: number, send: (chunk: T[]) => Promise<Result<R[], Meta>>): Promise<BulkResult<R>> {
  const data: R[] = [];
  const requestIds: (string | null)[] = [];
  let meta = null as Meta | null;
  let rateLimit: RateLimit | null = null;
  for (let i = 0; i < items.length; i += size) {
    let r: Result<R[], Meta>;
    try {
      r = await send(items.slice(i, i + size));
    } catch (e) {
      if (e instanceof ClearPostcodeError) e.partial = { data, meta, requestIds };
      throw e;
    }
    data.push(...r.data);
    requestIds.push(r.requestId);
    rateLimit = r.rateLimit;
    meta = { ...r.meta, sent: (meta?.sent ?? 0) + (r.meta.sent ?? r.data.length), found: (meta?.found ?? 0) + (r.meta.found ?? r.data.filter(found).length) };
  }
  return { data, meta, requestIds, rateLimit };
}

/** `fields` as the API takes it: comma-separated, or left out (an empty list is the full record). */
const fieldsOf = (fields: readonly string[] | undefined) => (fields?.length ? fields.join(",") : undefined);

/** Postcodes: lookup, validation, nearest, reverse geocoding, bulk, autocomplete and distance. */
export class Postcodes {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** Everything about one postcode (1 lookup when found; not found is free). `fields` trims the record. */
  lookup(postcode: string, params?: { fields?: undefined }, options?: RequestOptions): Promise<Result<PostcodeRecord, Meta>>;
  lookup<F extends PostcodeField>(postcode: string, params: { fields: readonly F[] }, options?: RequestOptions): Promise<Result<PostcodeWith<F>, Meta>>;
  lookup(postcode: string, params: { fields?: readonly PostcodeField[] } = {}, options: RequestOptions = {}): Promise<Result<Postcode, Meta>> {
    return this.#t.request("getPostcode", { path: { postcode }, query: { fields: fieldsOf(params.fields) } }, options);
  }

  /** Is the format valid, is it in the current edition, is it live? Never throws for a wrong postcode. */
  validate(postcode: string, options: RequestOptions = {}): Promise<Result<Validation, Meta>> {
    return this.#t.request("validatePostcode", { path: { postcode } }, options);
  }

  /** Live postcodes nearest this one, nearest first. */
  nearest(postcode: string, params: { radius?: number; limit?: number } = {}, options: RequestOptions = {}): Promise<Result<Near[], Meta>> {
    return this.#t.request("nearestToPostcode", { path: { postcode }, query: { radius: params.radius, limit: params.limit } }, options);
  }

  /** Live postcodes nearest a point (reverse geocoding), out to 20 km. */
  reverse(point: ReversePoint, options: RequestOptions = {}): Promise<Result<Near[], Meta>> {
    return this.#t.request("reverseGeocode", { query: { lat: point.latitude, lon: point.longitude, radius: point.radius, limit: point.limit } }, options);
  }

  /** Any number of postcodes, sent 100 a call, in the order given. Needs a secret key. */
  bulk(postcodes: readonly string[], params?: { fields?: undefined }, options?: RequestOptions): Promise<BulkResult<BulkLookupItem<PostcodeRecord>>>;
  bulk<F extends PostcodeField>(postcodes: readonly string[], params: { fields: readonly F[] }, options?: RequestOptions): Promise<BulkResult<BulkLookupItem<PostcodeWith<F>>>>;
  bulk(postcodes: readonly string[], params: { fields?: readonly PostcodeField[] } = {}, options: RequestOptions = {}): Promise<BulkResult<BulkItem>> {
    return chunked(postcodes, BULK_POSTCODES, (chunk) => this.#t.request("bulkLookup", { query: { fields: fieldsOf(params.fields) }, body: { postcodes: chunk } }, options));
  }

  /** Nearest postcodes for any number of points, sent 20 a call. Needs a secret key. */
  bulkReverse(points: readonly ReversePoint[], options: RequestOptions = {}): Promise<BulkResult<ReverseItem>> {
    return chunked(points, BULK_POINTS, (chunk) =>
      this.#t.request("bulkReverse", { body: { points: chunk.map((p) => ({ lat: p.latitude, lon: p.longitude, radius: p.radius, limit: p.limit })) } }, options),
    );
  }

  /** Postcodes (or districts, for 1 to 4 characters) that start with what has been typed. Free. */
  autocomplete(q: string, params: { limit?: number } = {}, options: RequestOptions = {}): Promise<Result<Suggestion[], Meta>> {
    return this.#t.request("autocomplete", { query: { q, limit: params.limit } }, options);
  }

  /** Straight-line distance between two postcodes, in kilometres and miles, with the bearing. */
  distance(from: string, to: string, options: RequestOptions = {}): Promise<Result<Distance, Meta>> {
    return this.#t.request("distance", { query: { from, to } }, options);
  }
}

/** Postcode districts (outward codes such as SW1A). */
export class Outcodes {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** One district: counts, sectors, centre, councils, wards, constituencies and places. */
  get(outcode: string, options: RequestOptions = {}): Promise<Result<District, Meta>> {
    return this.#t.request("getOutcode", { path: { outcode } }, options);
  }

  /** One page of the district's live postcodes (1 lookup a page). Needs a secret key. */
  postcodes(outcode: string, params: { cursor?: string; limit?: number } = {}, options: RequestOptions = {}): Promise<Page<OutcodePostcode, Meta>> {
    return pageOf(this.#t, "outcodePostcodes", { path: { outcode }, query: { limit: params.limit } }, "cursor", params.cursor ?? null, options);
  }

  /** Every live postcode in the district, page after page. Needs a secret key. */
  allPostcodes(outcode: string, params: { limit?: number } = {}, options: RequestOptions = {}): AsyncGenerator<OutcodePostcode> {
    return every(() => this.postcodes(outcode, params, options));
  }
}

/** Postcode sectors (such as SW1A 1). */
export class Sectors {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** One sector: its live postcodes with coordinates, centre, councils and wards. */
  get(sector: string, options: RequestOptions = {}): Promise<Result<Sector, Meta>> {
    return this.#t.request("getSector", { path: { sector } }, options);
  }
}

/** Postcode areas (the letters, such as SW). */
export class Areas {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** One area: its name, counts and every district in it. */
  get(area: string, options: RequestOptions = {}): Promise<Result<Area, Meta>> {
    return this.#t.request("getArea", { path: { area } }, options);
  }
}

/** Places by name (OS Open Names). */
export class Places {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** Cities, towns, villages and neighbourhoods whose name starts with `q`; accents optional. */
  search(q: string, params: { limit?: number } = {}, options: RequestOptions = {}): Promise<Result<Place[], Meta>> {
    return this.#t.request("places", { query: { q, limit: params.limit } }, options);
  }
}

/** Your account. */
export class Account {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** Your plan, this period's allowance, lookups used, credits and when it resets. Free. Needs a secret key. */
  usage(options: RequestOptions = {}): Promise<Result<Usage, Meta>> {
    return this.#t.request("usage", {}, options);
  }
}

/** Defaults every client shares. */
export function transportConfig(options: ClientOptions, key: string | null, extra: Pick<TransportConfig, "headers" | "keyInQuery">): TransportConfig {
  if (!options.fetch && typeof globalThis.fetch !== "function") throw new TypeError("No fetch here: pass one as the fetch option.");
  return {
    key,
    baseUrl: (options.baseUrl ?? BASE_URL).replace(/\/+$/, ""),
    timeout: options.timeout ?? 10_000,
    maxRetries: options.maxRetries ?? 2,
    maxRetryDelay: options.maxRetryDelay ?? 60_000,
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    ...extra,
  };
}

/** The resources every client carries. */
export class Client {
  readonly postcodes: Postcodes;
  readonly outcodes: Outcodes;
  readonly sectors: Sectors;
  readonly areas: Areas;
  readonly places: Places;
  readonly account: Account;
  readonly addresses: Addresses;

  constructor(config: TransportConfig) {
    const t = new Transport(config);
    this.postcodes = new Postcodes(t);
    this.outcodes = new Outcodes(t);
    this.sectors = new Sectors(t);
    this.areas = new Areas(t);
    this.places = new Places(t);
    this.account = new Account(t);
    this.addresses = new Addresses(t);
  }
}
