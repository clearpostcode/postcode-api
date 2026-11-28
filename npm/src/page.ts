import type { OperationTypes } from "./generated.ts";
import type { Call, RequestOptions, Result, Transport } from "./http.ts";

/** One page of a list. `next()` fetches the page after it (null after the last). */
export interface Page<T, M> extends Result<T[], M> {
  /** meta.next_cursor: pass it as `cursor` for the next page; null on the last page. */
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  next(options?: RequestOptions): Promise<Page<T, M> | null>;
}

type Paged = { [K in keyof OperationTypes]: OperationTypes[K]["meta"] extends { next_cursor?: string | null } ? (OperationTypes[K]["data"] extends unknown[] ? K : never) : never }[keyof OperationTypes];
type Item<I extends Paged> = OperationTypes[I]["data"][number];

/** A page of a cursor-paged operation; `cursorParam` names the query parameter the cursor goes back in. */
export async function pageOf<I extends Paged>(t: Transport, id: I, call: Call, cursorParam: string, cursor: string | null, options: RequestOptions): Promise<Page<Item<I>, OperationTypes[I]["meta"]>> {
  const r = await t.request(id, cursor ? { ...call, query: { ...call.query, [cursorParam]: cursor } } : call, options);
  const nextCursor = r.meta.next_cursor ?? null;
  return {
    ...r,
    data: r.data as Item<I>[],
    nextCursor,
    hasMore: nextCursor !== null,
    next: (o = options) => (nextCursor === null ? Promise.resolve(null) : pageOf(t, id, call, cursorParam, nextCursor, o)),
  };
}

/** Every item of a list, following the cursor page after page. */
export async function* every<T, M>(first: Promise<Page<T, M>>): AsyncGenerator<T> {
  for (let page: Page<T, M> | null = await first; page; page = await page.next()) yield* page.data;
}
