import type { Meta, Problem, ProblemCode } from "./generated.ts";

/** What a bulk call had answered (and billed) before the chunk that failed. */
export interface BulkPartial {
  readonly data: unknown[];
  readonly meta: Meta | null;
  readonly requestIds: (string | null)[];
}

/** Every error the client throws. */
export class ClearPostcodeError extends Error {
  override name = "ClearPostcodeError";
  /** Set when a bulk call fails part-way: the chunks already answered, so nothing billed is lost. */
  partial: BulkPartial | null = null;
}

/**
 * The API answered with an error: an RFC 9457 problem. `code` is the problem type ("postcode_not_found"), `requestId`
 * the id to quote to support, `retryAfter` the seconds the API asked you to wait (429 and 503), when it said.
 */
export class APIError extends ClearPostcodeError {
  override name = "APIError";
  readonly status: number;
  /** The problem type. New codes may appear, so match the ones you handle and let the rest through. */
  readonly code: ProblemCode | (string & {}) | null;
  readonly title: string | null;
  readonly detail: string | null;
  readonly requestId: string | null;
  readonly retryAfter: number | null;
  /** The problem body as the API sent it (extra members such as `parameters`, `resets` or `upgrade` included). */
  readonly problem: Partial<Problem>;
  readonly headers: Headers;

  constructor(status: number, problem: Partial<Problem> | null, headers: Headers, retryAfter: number | null) {
    const p = problem ?? {};
    const code = typeof p.type === "string" && p.type.includes("#") ? (p.type.slice(p.type.lastIndexOf("#") + 1) as ProblemCode) : null;
    const requestId = p.request_id ?? headers.get("x-request-id");
    super(`${status}${code ? ` ${code}` : ""}: ${p.detail ?? p.title ?? "the API answered with an error"}${requestId ? ` (request ${requestId})` : ""}`);
    this.status = status;
    this.code = code;
    this.title = p.title ?? null;
    this.detail = p.detail ?? null;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
    this.problem = p;
    this.headers = headers;
  }
}

/** 400 or 413: a parameter, the postcode format or the body (invalid_postcode, unknown_parameter, bad_request…). */
export class BadRequestError extends APIError {
  override name = "BadRequestError";
}
/** 401: the key is missing where one is needed, malformed or not active (invalid_key, key_required). */
export class AuthenticationError extends APIError {
  override name = "AuthenticationError";
}
/** 402: the period's lookups, or the address credits, are used up (quota_exceeded, address_credits_exhausted). */
export class QuotaExceededError extends APIError {
  override name = "QuotaExceededError";
}
/** 403: the key may not make this call (origin_not_allowed, publishable_key_not_allowed, address_lookup_not_enabled…). */
export class PermissionDeniedError extends APIError {
  override name = "PermissionDeniedError";
}
/** 404: no such postcode, district or address (postcode_not_found, not_covered, not_found). */
export class NotFoundError extends APIError {
  override name = "NotFoundError";
}
/** 422: a real postcode with no coordinates (no_position: the Channel Islands and the Isle of Man). */
export class UnprocessableEntityError extends APIError {
  override name = "UnprocessableEntityError";
}
/** 429: too many requests, a day's keyless allowance, or the key's daily cap (rate_limited, daily_cap_reached). */
export class RateLimitError extends APIError {
  override name = "RateLimitError";
}
/** 5xx: a moment's trouble on the API's side (server_error, service_unavailable). Retried for you. */
export class InternalServerError extends APIError {
  override name = "InternalServerError";
}

/** The API could not be reached (DNS, TLS, a dropped connection). Retried for you. */
export class APIConnectionError extends ClearPostcodeError {
  override name = "APIConnectionError";
}
/** No answer within the timeout. Retried for you. */
export class APITimeoutError extends APIConnectionError {
  override name = "APITimeoutError";
}

const BY_STATUS: Record<number, typeof APIError> = {
  400: BadRequestError,
  401: AuthenticationError,
  402: QuotaExceededError,
  403: PermissionDeniedError,
  404: NotFoundError,
  413: BadRequestError,
  422: UnprocessableEntityError,
  429: RateLimitError,
};

/** The error class for an HTTP status. */
export function errorFor(status: number, problem: Partial<Problem> | null, headers: Headers, retryAfter: number | null): APIError {
  const E = BY_STATUS[status] ?? (status >= 500 ? InternalServerError : APIError);
  return new E(status, problem, headers, retryAfter);
}
