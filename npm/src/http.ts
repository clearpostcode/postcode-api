import { OPERATIONS, type OperationId, type OperationTypes, type Problem } from "./generated.ts";
import { APIConnectionError, APIError, APITimeoutError, errorFor } from "./errors.ts";

/** Options for one call. */
export interface RequestOptions {
  /** Cancel the call (and any retry wait). */
  signal?: AbortSignal;
  /** Milliseconds to wait for each attempt. */
  timeout?: number;
  /** Retries after a 429, a 5xx, a timeout or a dropped connection. */
  maxRetries?: number;
}

/** The limit closest to running out, from the RateLimit headers. */
export interface RateLimit {
  /** Which limit: "month" (a keyed call's lookups), "day" (keyless), "burst" or "minute". */
  policy: string | null;
  limit: number | null;
  remaining: number | null;
  /** Seconds until it resets. */
  reset: number | null;
}

/** One answer: `data` and `meta` as the API sent them, with the call's id and rate-limit state. */
export interface Result<D, M> {
  readonly data: D;
  readonly meta: M;
  readonly status: number;
  /** Quote it to support and the call can be traced. */
  readonly requestId: string | null;
  readonly rateLimit: RateLimit | null;
}

/** What the client needs to make calls. */
export interface TransportConfig {
  key: string | null;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  /** The longest wait the client accepts before a retry; a longer Retry-After is thrown to you at once. */
  maxRetryDelay: number;
  fetch: typeof fetch;
  /** Headers sent on every call (the user agent, outside browsers). */
  headers: Record<string, string>;
  /** Send the key as ?key= (publishable keys in browsers: no preflight) instead of the X-Api-Key header. */
  keyInQuery: boolean;
}

export type Params = Record<string, string | number | null | undefined>;

/** One operation's call: path parameters, query parameters (only the ones the operation takes) and a JSON body. */
export interface Call {
  path?: Record<string, string>;
  query?: Params;
  body?: unknown;
}

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** Seconds from a Retry-After header: delta-seconds or an HTTP date. */
function retryAfterOf(h: Headers): number | null {
  const v = h.get("retry-after");
  if (v === null) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, n);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, (at - Date.now()) / 1000);
}

const intOf = (v: string | null | undefined): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** RateLimit-Limit/-Remaining/-Reset, with the policy name and any gaps filled from RateLimit and RateLimit-Policy. */
export function rateLimitOf(h: Headers): RateLimit | null {
  const structured = h.get("ratelimit");
  const m = structured?.match(/^\s*"([^"]+)"\s*;(.*)$/);
  const item = (s: string | undefined, k: string) => s?.match(new RegExp(`(?:^|;)\\s*${k}=(\\d+)`))?.[1];
  const policy = m?.[1] ?? null;
  const q = policy ? h.get("ratelimit-policy")?.split(",").find((p) => p.trim().startsWith(`"${policy}"`)) : undefined;
  const r: RateLimit = {
    policy,
    limit: intOf(h.get("ratelimit-limit")) ?? intOf(item(q, "q")),
    remaining: intOf(h.get("ratelimit-remaining")) ?? intOf(item(m?.[2], "r")),
    reset: intOf(h.get("ratelimit-reset")) ?? intOf(item(m?.[2], "t")),
  };
  return r.policy === null && r.limit === null && r.remaining === null && r.reset === null ? null : r;
}

/** Wait ms, or until the signal aborts (then throw its reason). */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", stop);
      resolve();
    }
    function stop() {
      clearTimeout(t);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/** Exponential backoff with jitter: about 0.5 s, 1 s, 2 s… up to 8 s. */
const backoff = (attempt: number) => Math.min(8000, 500 * 2 ** attempt) * (0.5 + Math.random() / 2);

export class Transport {
  readonly config: TransportConfig;

  constructor(config: TransportConfig) {
    this.config = config;
  }

  /** The URL for an operation: path parameters encoded into the path, then the query it takes. */
  url(id: OperationId, call: Call): string {
    const op = OPERATIONS[id];
    const path = op.path.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(call.path?.[k] ?? "").trim()));
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(call.query ?? {})) {
      if (v === undefined || v === null) continue;
      if (!(op.query as readonly string[]).includes(k)) throw new TypeError(`${id} takes no "${k}" parameter (it takes: ${op.query.join(", ") || "none"})`);
      q.set(k, String(v));
    }
    if (this.config.key && this.config.keyInQuery) q.set("key", this.config.key);
    const s = q.toString();
    return `${this.config.baseUrl}${path}${s ? `?${s}` : ""}`;
  }

  /** Make the call, retrying 429s, 5xx answers, timeouts and dropped connections with backoff. */
  async request<I extends OperationId>(id: I, call: Call = {}, options: RequestOptions = {}): Promise<Result<OperationTypes[I]["data"], OperationTypes[I]["meta"]>> {
    const url = this.url(id, call);
    const headers: Record<string, string> = { accept: "application/json", ...this.config.headers };
    if (this.config.key && !this.config.keyInQuery) headers["x-api-key"] = this.config.key;
    if (call.body !== undefined) headers["content-type"] = "application/json";
    const init: RequestInit = { method: OPERATIONS[id].method, headers, body: call.body === undefined ? undefined : JSON.stringify(call.body) };
    const retries = options.maxRetries ?? this.config.maxRetries;
    for (let attempt = 0; ; attempt++) {
      let wait: number;
      try {
        const { response, text } = await this.attempt(url, init, options);
        if (response.ok) {
          let json: { data: OperationTypes[I]["data"]; meta: OperationTypes[I]["meta"] };
          try {
            json = JSON.parse(text) as typeof json;
          } catch {
            throw new APIError(response.status, { detail: "The answer was not JSON." }, response.headers, null);
          }
          return { data: json.data, meta: json.meta, status: response.status, requestId: response.headers.get("x-request-id"), rateLimit: rateLimitOf(response.headers) };
        }
        let problem: Partial<Problem> | null = null;
        try {
          problem = JSON.parse(text) as Partial<Problem>;
        } catch {
          problem = null;
        }
        const after = retryAfterOf(response.headers);
        const error = errorFor(response.status, problem, response.headers, after);
        if (!RETRY_STATUS.has(response.status) || attempt >= retries) throw error;
        const limit = rateLimitOf(response.headers);
        const advised = after ?? (response.status === 429 && limit?.remaining === 0 ? limit.reset : null);
        if (advised !== null && advised * 1000 > this.config.maxRetryDelay) throw error;
        wait = advised !== null ? advised * 1000 : backoff(attempt);
      } catch (e) {
        if (e instanceof APIError || options.signal?.aborted) throw e;
        if (!(e instanceof APIConnectionError) || attempt >= retries) throw e;
        wait = backoff(attempt);
      }
      await sleep(wait, options.signal);
    }
  }

  /** One attempt within the timeout: the response and its body. */
  private async attempt(url: string, init: RequestInit, options: RequestOptions): Promise<{ response: Response; text: string }> {
    const timeout = options.timeout ?? this.config.timeout;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new APITimeoutError(`No answer within ${timeout} ms`)), timeout);
    const outer = options.signal;
    const relay = () => ctl.abort(outer?.reason);
    if (outer?.aborted) relay();
    else outer?.addEventListener("abort", relay, { once: true });
    try {
      const response = await this.config.fetch(url, { ...init, signal: ctl.signal });
      return { response, text: await response.text() };
    } catch (e) {
      if (ctl.signal.reason instanceof APITimeoutError) throw ctl.signal.reason;
      if (outer?.aborted) throw outer.reason;
      throw new APIConnectionError(`Could not reach the ClearPostcode API: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", relay);
    }
  }
}
