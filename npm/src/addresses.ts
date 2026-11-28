import type { Address, AddressMeta, AddressSuggestion } from "./generated.ts";
import { type RequestOptions, type Result, Transport } from "./http.ts";
import { type Page, pageOf, every } from "./page.ts";

/**
 * Address lookup (Royal Mail PAF, early access), behind one adapter: each SDK call names its operation and parameters
 * here and nowhere else, so a change to an address route is one edit. A key is always needed, and the business it
 * serves must have Address lookup switched on in the dashboard; otherwise the API answers 403
 * address_lookup_not_enabled (a PermissionDeniedError).
 */
const ROUTES = {
  byPostcode: { op: "addressesByPostcode", postcode: "postcode", cursor: "cursor" },
  suggest: { op: "addressSuggest", q: "q", container: "container", limit: "limit" },
  retrieve: { op: "addressRetrieve", id: "id" },
  byUdprn: { op: "addressByUdprn", udprn: "udprn" },
} as const;

export interface AddressSuggestOptions extends RequestOptions {
  /** A container suggestion's id: list the addresses (or smaller containers) it holds. */
  container?: string;
  /** How many suggestions (1 to 100, default 10). */
  limit?: number;
}

export class Addresses {
  readonly #t: Transport;

  constructor(transport: Transport) {
    this.#t = transport;
  }

  /** One page of the addresses at a postcode, in delivery order (up to 100 a page; 1 address credit a page). */
  byPostcode(postcode: string, options: RequestOptions & { cursor?: string } = {}): Promise<Page<Address, AddressMeta>> {
    const r = ROUTES.byPostcode;
    return pageOf(this.#t, r.op, { query: { [r.postcode]: postcode } }, r.cursor, options.cursor ?? null, options);
  }

  /** Every address at a postcode, page after page. */
  allByPostcode(postcode: string, options: RequestOptions = {}): AsyncGenerator<Address> {
    return every(this.byPostcode(postcode, options));
  }

  /**
   * Suggestions as the customer types (free): kind "address" is one address (resolve its id with retrieve()), kind
   * "container" is a postcode, street or building holding `count` addresses (pass its id as `container`).
   */
  suggest(q: string, options: AddressSuggestOptions = {}): Promise<Result<AddressSuggestion[], AddressMeta>> {
    const r = ROUTES.suggest;
    return this.#t.request(r.op, { query: { [r.q]: q || undefined, [r.container]: options.container, [r.limit]: options.limit } }, options);
  }

  /** The full address for an address suggestion's id (1 address credit). */
  retrieve(id: string, options: RequestOptions = {}): Promise<Result<Address, AddressMeta>> {
    const r = ROUTES.retrieve;
    return this.#t.request(r.op, { path: { [r.id]: id } }, options);
  }

  /** The full address for a UDPRN, Royal Mail's number for one delivery point (1 address credit). */
  byUdprn(udprn: string | number, options: RequestOptions = {}): Promise<Result<Address, AddressMeta>> {
    const r = ROUTES.byUdprn;
    return this.#t.request(r.op, { path: { [r.udprn]: String(udprn) } }, options);
  }
}
