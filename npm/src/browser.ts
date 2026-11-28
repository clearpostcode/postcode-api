/**
 * ClearPostcode for web pages: the same client, for publishable keys (cp_pub_, locked to your domains) or no key.
 * It refuses a secret key before any call, sends the key as ?key= (no CORS preflight) and offers only the calls a
 * browser may make. Docs: https://clearpostcode.co.uk/developers/docs
 */
import { Client, type ClientOptions, type Postcodes, type Outcodes, type Sectors, type Areas, type Places, transportConfig } from "./client.ts";
import type { Addresses } from "./addresses.ts";
import { ClearPostcodeError } from "./errors.ts";

export interface BrowserClientOptions extends Omit<ClientOptions, "key"> {
  /** A publishable key (cp_pub_). Optional: postcode lookups, validation and autocomplete also work without one. */
  key?: string | null;
}

/** The calls a publishable key or a keyless browser may make (bulk calls, every postcode in a district and usage
 *  need a secret key, so they stay on servers). */
export interface BrowserClient {
  readonly postcodes: Omit<Postcodes, "bulk" | "bulkReverse">;
  readonly outcodes: Pick<Outcodes, "get">;
  readonly sectors: Sectors;
  readonly areas: Areas;
  readonly places: Places;
  readonly addresses: Addresses;
}

/** The browser client. Throws ClearPostcodeError for anything but a publishable key, before any call. */
export class ClearPostcode implements BrowserClient {
  readonly postcodes: BrowserClient["postcodes"];
  readonly outcodes: BrowserClient["outcodes"];
  readonly sectors: Sectors;
  readonly areas: Areas;
  readonly places: Places;
  readonly addresses: Addresses;

  constructor(options: BrowserClientOptions = {}) {
    const key = options.key || null;
    if (key && !key.startsWith("cp_pub_")) {
      throw new ClearPostcodeError(key.startsWith("cp_live_") ? "Secret keys (cp_live_) stay on your server. In a browser, use a publishable key (cp_pub_) locked to your domain." : "Browser keys start cp_pub_. Copy your publishable key from your dashboard.");
    }
    const c = new Client(transportConfig(options, key, { keyInQuery: true, headers: {} }));
    this.postcodes = c.postcodes;
    this.outcodes = c.outcodes;
    this.sectors = c.sectors;
    this.areas = c.areas;
    this.places = c.places;
    this.addresses = c.addresses;
  }
}

export default ClearPostcode;
export { VERSION } from "./version.ts";
export * from "./errors.ts";
export * from "./generated.ts";
export type { PostcodeRecord, PostcodeField, PostcodeWith, Postcodes, Outcodes, Sectors, Areas, Places } from "./client.ts";
export type { Addresses, AddressSuggestOptions } from "./addresses.ts";
export type { RateLimit, RequestOptions, Result } from "./http.ts";
