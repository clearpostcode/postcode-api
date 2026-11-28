/**
 * ClearPostcode: UK postcode data (lookup, validation, autocomplete, nearest, reverse geocoding, distance, districts,
 * sectors, areas and places) and Address lookup (Royal Mail PAF, early access). No dependencies.
 * Docs: https://clearpostcode.co.uk/developers/docs
 */
import { Client, type ClientOptions, transportConfig } from "./client.ts";
import { ClearPostcodeError } from "./errors.ts";
import { VERSION } from "./version.ts";

type Runtime = { process?: { env?: Record<string, string | undefined>; versions?: Record<string, string | undefined> }; document?: unknown; navigator?: { userAgent?: string }; Deno?: { version?: { deno?: string } } };
const g = globalThis as Runtime;

/** The runtime, for the user agent: node/24.12.0, bun/1.3.0, deno/2.5.0. */
function runtime(): string {
  const v = g.process?.versions;
  if (v?.bun) return `bun/${v.bun}`;
  if (g.Deno?.version?.deno) return `deno/${g.Deno.version.deno}`;
  return v?.node ? `node/${v.node}` : "js";
}

/**
 * The client for servers, scripts and edge functions. The key comes from `key`, else the CLEAR_POSTCODE_KEY
 * environment variable; with neither, calls run keyless (rate-limited per network). `key: null` forces keyless.
 */
export class ClearPostcode extends Client {
  constructor(options: ClientOptions = {}) {
    const key = (options.key === undefined ? g.process?.env?.CLEAR_POSTCODE_KEY : options.key) || null;
    // A web page or a web worker: browsers' user agents start "Mozilla/"; Node, Bun, Deno and Workers' do not.
    const inBrowser = typeof g.document !== "undefined" || /^Mozilla\//.test(g.navigator?.userAgent ?? "");
    if (inBrowser && key?.startsWith("cp_live_")) throw new ClearPostcodeError("Secret keys (cp_live_) stay on your server. In a browser, use a publishable key (cp_pub_) locked to your domain, with clearpostcode/browser.");
    super(transportConfig(options, key, { keyInQuery: false, headers: inBrowser ? {} : { "user-agent": `clearpostcode-js/${VERSION} ${runtime()}` } }));
  }
}

export default ClearPostcode;
export { VERSION };
export * from "./errors.ts";
export type * from "./generated.ts";
export { BASE_URL } from "./generated.ts";
export type { ClientOptions, PostcodeRecord, PostcodeField, PostcodeWith, BulkLookupItem, BulkResult, ReversePoint, Postcodes, Outcodes, Sectors, Areas, Places, Account } from "./client.ts";
export { BULK_POSTCODES, BULK_POINTS } from "./client.ts";
export type { Addresses, AddressSuggestParams } from "./addresses.ts";
export type { Page } from "./page.ts";
export type { RateLimit, RequestOptions, Result } from "./http.ts";
