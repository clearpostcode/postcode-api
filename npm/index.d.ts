export declare const BASE: string;

export type Named = { code: string; name: string | null } | null;
export type Meta = {
  edition: string;
  next_edition_due: string;
  coverage: string;
  licence: string;
  attribution: string[];
  docs: string;
  [k: string]: unknown;
};
export type Answer<T = unknown> = { data: T; meta: Meta };

export type Postcode = {
  postcode: string;
  status: "live" | "terminated";
  outcode?: string;
  incode?: string;
  sector?: string;
  district?: string;
  area?: string;
  introduced?: string | null;
  terminated?: string | null;
  replaced_by?: string | null;
  user_type?: "small" | "large";
  location?: {
    latitude: number | null;
    longitude: number | null;
    easting: number | null;
    northing: number | null;
    positional_quality: number | null;
    positional_quality_label: string | null;
  };
  country?: Named;
  region?: Named;
  county?: Named;
  county_electoral_division?: Named;
  local_authority?: Named;
  ward?: Named;
  parish?: Named;
  constituency?: Named;
  police_force?: Named;
  nhs_region?: Named;
  icb?: Named;
  sub_icb?: Named;
  national_park?: Named;
  built_up_area?: Named;
  travel_to_work_area?: Named;
  lsoa?: Named;
  msoa?: Named;
  output_area?: string | null;
  rural_urban?: { code: string; name: string | null; urban: boolean | null } | null;
  area_classification?: string | null;
  deprivation?: { index: string; rank: number; of: number; decile: number } | null;
  [k: string]: unknown;
};

export type Validation = {
  input: string;
  postcode: string;
  format_valid: boolean;
  known: boolean | null;
  status: "live" | "terminated" | null;
  valid: boolean | null;
  coverage: "covered" | "not_covered";
  replaced_by?: string | null;
  [k: string]: unknown;
};

/** RFC 9457 problem details. */
export type Problem = {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  request_id?: string;
  [k: string]: unknown;
};

export declare class ClearPostcodeError extends Error {
  constructor(status: number, problem?: Problem, request_id?: string);
  status: number;
  problem: Problem;
  request_id: string | undefined;
}

export type Options = { key?: string; base?: string; fetch?: typeof fetch; timeout?: number };
export type Query = Record<string, string | number | null | undefined>;

export declare class ClearPostcode {
  constructor(opts?: Options);
  key: string | undefined;
  base: string;
  request<T = unknown>(method: "GET" | "POST", path: string, init?: { query?: Query; body?: unknown }): Promise<Answer<T>>;
  get<T = unknown>(path: string, query?: Query): Promise<Answer<T>>;
  post<T = unknown>(path: string, body: unknown, query?: Query): Promise<Answer<T>>;

  lookup(postcode: string, opts?: { fields?: string }): Promise<Answer<Postcode>>;
  validate(postcode: string): Promise<Answer<Validation>>;
  nearest(postcode: string, opts?: { radius?: number; limit?: number }): Promise<Answer<unknown[]>>;
  reverse(point: { lat: number; lon: number; radius?: number; limit?: number }): Promise<Answer<unknown[]>>;
  bulk(postcodes: string[], opts?: { fields?: string }): Promise<Answer<unknown[]>>;
  bulkReverse(points: { lat: number; lon: number; limit?: number }[]): Promise<Answer<unknown[]>>;
  autocomplete(q: string, opts?: { limit?: number }): Promise<Answer<{ type: string; postcode: string }[]>>;
  distance(from: string, to: string): Promise<Answer>;

  outcode(outcode: string): Promise<Answer>;
  outcodePostcodes(outcode: string, opts?: { after?: string; limit?: number }): Promise<Answer<unknown[]>>;
  sector(sector: string): Promise<Answer>;
  area(area: string): Promise<Answer>;

  places(q: string, opts?: { limit?: number }): Promise<Answer<unknown[]>>;
  usage(): Promise<Answer>;

  addresses(postcode: string): Promise<Answer<unknown[]>>;
  addressSuggest(q: string): Promise<Answer<unknown[]>>;
  address(udprn: string | number): Promise<Answer>;
}
export default ClearPostcode;
