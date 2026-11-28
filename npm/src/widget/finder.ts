/**
 * The postcode finder: one input becomes an ARIA combobox (WAI-ARIA 1.2, list autocomplete). Postcode mode formats the
 * postcode as it is typed, suggests postcodes, checks the postcode and fills the fields the record holds (council,
 * county, region, country, ward, constituency, coordinates). Address mode (a publishable key whose account has
 * Address lookup) suggests addresses from a postcode or the start of an address and fills the address fields.
 */
import { Addresses } from "../addresses.ts";
import { Postcodes, transportConfig } from "../client.ts";
import { ClearPostcodeError, APIError } from "../errors.ts";
import type { Address, AddressSuggestion, Suggestion } from "../generated.ts";
import { Transport } from "../http.ts";
import type { PostcodeField, PostcodeWith } from "../client.ts";

/** A field the finder can fill. */
export type FieldName = "postcode" | "line1" | "line2" | "line3" | "lines" | "town" | "organisation" | "udprn" | RecordField;
type RecordField = "council" | "county" | "region" | "country" | "ward" | "constituency" | "latitude" | "longitude";

export interface Messages {
  found: string;
  invalid: string;
  unknown: string;
  terminated: string;
  retired: string;
  use: string;
  notCovered: string;
  error: string;
  suggestions: string;
  filled: string;
  addresses: string;
  postcodes: string;
}

/** What the finder says. {postcode}, {council}, {replacement}, {count} and {address} are filled in. "" says nothing. */
export const MESSAGES: Messages = {
  found: "{postcode} · {council}",
  invalid: "Enter a full UK postcode, like SW1A 1AA.",
  unknown: "{postcode} isn't in the postcode data. Check it, or carry on if it's brand new.",
  terminated: "{postcode} is no longer in use. The nearest live postcode is {replacement}.",
  retired: "{postcode} is no longer in use.",
  use: "Use {replacement}",
  notCovered: "{postcode}: a Northern Ireland postcode, and the format checks out.",
  error: "The postcode check didn't answer. Carry on as normal.",
  suggestions: "{count} suggestions. Use the up and down arrows to choose.",
  filled: "Address filled: {address}",
  addresses: "{count} addresses",
  postcodes: "{count} postcodes",
};

/** The fields a postcode record fills, and what the lookup asks the API for. */
const RECORD: Record<RecordField, [PostcodeField, (r: Rec) => string | number | null | undefined]> = {
  council: ["local_authority", (r) => r.local_authority?.name],
  county: ["county", (r) => r.county?.name],
  region: ["region", (r) => r.region?.name],
  country: ["country", (r) => r.country?.name],
  ward: ["ward", (r) => r.ward?.name],
  constituency: ["constituency", (r) => r.constituency?.name],
  latitude: ["location", (r) => r.location?.latitude],
  longitude: ["location", (r) => r.location?.longitude],
};
type Rec = Partial<PostcodeWith<"local_authority" | "county" | "region" | "country" | "ward" | "constituency" | "location" | "replaced_by">>;

/** Address fields, and the autocomplete token that finds each in a form. */
const ADDRESS: Record<Exclude<FieldName, RecordField>, [string | null, (a: Address) => string]> = {
  postcode: ["postal-code", (a) => a.postcode],
  line1: ["address-line1", (a) => a.line_1],
  line2: ["address-line2", (a) => a.line_2],
  line3: ["address-line3", (a) => a.line_3],
  lines: ["street-address", (a) => [a.line_1, a.line_2, a.line_3].filter(Boolean).join("\n")],
  town: ["address-level2", (a) => a.post_town],
  organisation: ["organization", (a) => a.organisation_name],
  udprn: [null, (a) => a.udprn],
};

export interface FinderOptions {
  /** A publishable key (cp_pub_), locked to your domains. Optional in postcode mode; address mode needs one. */
  key?: string | null;
  /** "auto" (default): address mode when the key's account has Address lookup, else postcode mode. */
  mode?: "auto" | "postcode" | "address";
  /** Where each field is, as a CSS selector or an element; null leaves a field alone. Otherwise the finder looks in
   *  the input's part of the form for [data-clearpostcode="<field>"], then the autocomplete token (postal-code,
   *  address-line1, address-level2…). */
  fields?: Partial<Record<FieldName, string | HTMLElement | null>>;
  /** Your own wording (any message; "" says nothing). */
  messages?: Partial<Messages>;
  /** Where the suggestion list and the message go (default: straight after the input). */
  mount?: HTMLElement;
  onPostcode?: (record: Rec & { postcode: string; status: "live" | "terminated" }) => void;
  onAddress?: (address: Address) => void;
  onError?: (error: ClearPostcodeError) => void;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface Finder {
  /** The mode in use: null until a keyed finder in auto mode has asked the API. */
  readonly mode: "postcode" | "address" | null;
  /** Remove the finder: its list, message, listeners and ARIA attributes. */
  destroy(): void;
}

/** A complete UK postcode, the API's way: SW1A1AA, sw1a 1aa, GIR 0AA. */
const FULL = /^([A-PR-UWYZ][0-9][0-9A-HJKPS-UW]?|[A-PR-UWYZ][A-HK-Y][0-9][0-9ABEHMNPRV-Y]?|GIR)\s*([0-9][ABD-HJLNP-UW-Z]{2})$/i;
/** What could be the start of a postcode (upper-cased as it is typed): SW, SW1A, sw1a 1a. */
const PARTIAL = /^\s*[A-Za-z]{1,2}([0-9][A-Za-z0-9]?)?(\s*[0-9][A-Za-z]{0,2})?\s*$/;
/** A postcode in its canonical form, or null. */
export function formatPostcode(input: string): string | null {
  const m = input.trim().match(FULL);
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : null;
}

/** Address lookup, by key, once an auto finder has asked: every finder with the key shares the answer. */
const modes = new Map<string, "postcode" | "address">();
let ids = 0;

const fill = (text: string, values: Record<string, string | number | undefined | null>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));

/** Set a field's value as a person would, so React, Vue and plain listeners all see it. */
function setValue(el: HTMLElement, value: string): void {
  if (el.tagName === "SELECT") {
    const want = value.toLowerCase();
    const opt = [...(el as HTMLSelectElement).options].find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want);
    if (!opt) return;
    value = opt.value;
  }
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Turn an input into a postcode finder. `target` is the input or a selector for it. */
export function attach(target: string | HTMLInputElement, options: FinderOptions = {}): Finder {
  const input = typeof target === "string" ? document.querySelector<HTMLInputElement>(target) : target;
  if (!input) throw new ClearPostcodeError(`No input matches ${String(target)}`);
  const doc = input.ownerDocument;
  const key = options.key || null;
  if (key && !key.startsWith("cp_pub_")) throw new ClearPostcodeError("The finder runs in the browser: use a publishable key (cp_pub_), never a secret one.");
  const t = new Transport(transportConfig({ baseUrl: options.baseUrl, fetch: options.fetch, maxRetries: 1, timeout: 8000 }, key, { keyInQuery: true, headers: {} }));
  const postcodes = new Postcodes(t);
  const addresses = new Addresses(t);
  const say: Messages = { ...MESSAGES, ...options.messages };
  let mode: "postcode" | "address" | null = options.mode === "postcode" || !key ? "postcode" : options.mode === "address" ? "address" : (modes.get(key) ?? null);

  const n = ++ids;
  const list = doc.createElement("ul");
  list.id = `cpw-list-${n}`;
  list.className = "cpw-list";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  const status = doc.createElement("div");
  status.id = `cpw-status-${n}`;
  status.className = "cpw-status";
  status.setAttribute("role", "status");
  const sr = doc.createElement("span");
  sr.className = "cpw-sr";
  sr.setAttribute("aria-live", "polite");
  if (options.mount) options.mount.append(list, status, sr);
  else input.after(list, status, sr);

  const before = ["role", "aria-autocomplete", "aria-expanded", "aria-controls", "aria-describedby", "aria-activedescendant", "aria-invalid"].map((a) => [a, input.getAttribute(a)] as const);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-describedby", [input.getAttribute("aria-describedby"), status.id].filter(Boolean).join(" "));
  input.dataset.cpw = "1";

  type Item = { label: string; meta?: string; pick: () => void };
  let items: Item[] = [];
  let active = -1;
  let seq = 0;
  let pending: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let selfEdit = false;

  /** The part of the page the input fills: the largest ancestor (within its form) holding no other finder. */
  function scope(): ParentNode {
    let s: HTMLElement = input!;
    const top = input!.form ?? doc.body;
    while (s !== top && s.parentElement && ![...s.parentElement.querySelectorAll("[data-cpw]")].some((x) => x !== input)) s = s.parentElement;
    return s;
  }
  function field(name: FieldName): HTMLElement | null {
    const given = options.fields?.[name];
    if (given === null) return null;
    if (given instanceof HTMLElement) return given;
    const root = scope();
    if (typeof given === "string") return root.querySelector<HTMLElement>(given) ?? doc.querySelector<HTMLElement>(given);
    const tagged = root.querySelector<HTMLElement>(`[data-clearpostcode="${name}"]`);
    if (tagged) return tagged;
    const token = name in ADDRESS ? ADDRESS[name as keyof typeof ADDRESS][0] : null;
    return token ? (root.querySelector<HTMLElement>(`[autocomplete~="${token}"]`) ?? null) : null;
  }
  /** Fill a field. No value clears it, but only if it still holds what the finder put there: a value the customer
   *  typed is never touched, and nothing from the last postcode outlives the next one. */
  const mine = new WeakMap<HTMLElement, string>();
  function put(name: FieldName, value: string | number | null | undefined): void {
    const el = field(name);
    if (!el) return;
    const now = (el as HTMLInputElement).value;
    const next = value === null || value === undefined ? (mine.has(el) && mine.get(el) === now ? "" : null) : String(value);
    if (next === null) return;
    mine.set(el, next);
    if (next === now) return;
    selfEdit = el === input;
    setValue(el, next);
    selfEdit = false;
  }
  const clearRecord = () => (Object.keys(RECORD) as RecordField[]).forEach((f) => put(f, null));

  function show(text: string, state: "ok" | "warn" | "error" | "", button?: { label: string; then: () => void }): void {
    status.textContent = text;
    status.dataset.state = state;
    if (button) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "cpw-use";
      b.textContent = button.label;
      b.addEventListener("click", button.then);
      status.append(" ", b);
    }
    if (state === "error") input!.setAttribute("aria-invalid", "true");
    else input!.removeAttribute("aria-invalid");
  }
  function open(next: Item[], announce = true): void {
    items = next;
    active = -1;
    list.replaceChildren(
      ...items.map((it, i) => {
        const li = doc.createElement("li");
        li.id = `${list.id}-${i}`;
        li.className = "cpw-option";
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");
        li.textContent = it.label;
        if (it.meta) {
          const m = doc.createElement("span");
          m.className = "cpw-meta";
          m.textContent = it.meta;
          li.append(m);
        }
        li.addEventListener("click", () => choose(i));
        return li;
      }),
    );
    const shown = items.length > 0;
    list.hidden = !shown;
    input!.setAttribute("aria-expanded", String(shown));
    input!.removeAttribute("aria-activedescendant");
    if (shown) {
      list.style.top = `${input!.offsetTop + input!.offsetHeight}px`;
      list.style.left = `${input!.offsetLeft}px`;
      list.style.minWidth = `${input!.offsetWidth}px`;
    }
    sr.textContent = shown && announce ? fill(say.suggestions, { count: items.length }) : "";
  }
  const close = () => open([], false);
  function move(to: number): void {
    if (!items.length) return;
    active = (to + items.length) % items.length;
    [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
    const li = list.children[active] as HTMLElement;
    input!.setAttribute("aria-activedescendant", li.id);
    li.scrollIntoView?.({ block: "nearest" });
  }
  function choose(i: number): void {
    const it = items[i];
    close();
    it?.pick();
  }

  /** One request at a time: a newer keystroke aborts the older call, and stale answers are dropped. */
  async function call<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    pending?.abort();
    const ctl = (pending = new AbortController());
    const mine = ++seq;
    try {
      const r = await run(ctl.signal);
      return mine === seq ? r : undefined;
    } catch (e) {
      if (mine !== seq || ctl.signal.aborted) return undefined;
      throw e;
    }
  }
  function failed(e: unknown): void {
    show(say.error, "warn");
    if (e instanceof ClearPostcodeError) options.onError?.(e);
  }

  // ---------------------------------------------------------------------------------------------- postcode mode
  const wanted = (): PostcodeField[] => [...new Set<PostcodeField>(["local_authority", "replaced_by", ...(Object.keys(RECORD) as RecordField[]).filter((f) => field(f)).map((f) => RECORD[f][0])])];

  async function check(pc: string): Promise<void> {
    try {
      const r = await call((signal) => postcodes.lookup(pc, { fields: wanted() }, { signal }));
      if (!r) return;
      const rec = r.data as Rec & { postcode: string; status: "live" | "terminated" };
      if (rec.status === "terminated") {
        clearRecord();
        const replacement = rec.replaced_by;
        show(fill(replacement ? say.terminated : say.retired, { postcode: rec.postcode, replacement }), "warn", replacement ? { label: fill(say.use, { replacement }), then: () => pick(replacement) } : undefined);
      } else {
        show(rec.local_authority?.name ? fill(say.found, { postcode: rec.postcode, council: rec.local_authority.name }) : rec.postcode, "ok");
        for (const f of Object.keys(RECORD) as RecordField[]) put(f, RECORD[f][1](rec));
      }
      options.onPostcode?.(rec);
    } catch (e) {
      const code = e instanceof APIError ? e.code : null;
      clearRecord();
      if (code === "postcode_not_found") show(fill(say.unknown, { postcode: pc }), "warn");
      else if (code === "not_covered") show(fill(say.notCovered, { postcode: pc }), "ok");
      else if (code === "invalid_postcode") show(say.invalid, "error");
      else failed(e);
    }
  }
  function pick(pc: string): void {
    put("postcode", pc);
    if (field("postcode") !== input) {
      selfEdit = true;
      setValue(input!, pc);
      selfEdit = false;
    }
    void check(pc);
  }
  async function suggestPostcodes(q: string): Promise<void> {
    try {
      const r = await call((signal) => postcodes.autocomplete(q, { limit: 8 }, { signal }));
      if (!r) return;
      open(
        r.data.map((s: Suggestion) =>
          s.type === "district"
            ? { label: s.outcode, meta: fill(say.postcodes, { count: s.postcodes.toLocaleString("en-GB") }), pick: () => typed(`${s.outcode} `, true) }
            : { label: s.postcode, pick: () => pick(s.postcode) },
        ),
      );
    } catch {
      close(); // Suggestions are a convenience: the check on a full postcode still runs.
    }
  }

  // ----------------------------------------------------------------------------------------------- address mode
  function containerItem(s: AddressSuggestion): Item {
    return s.kind === "container"
      ? { label: s.suggestion, meta: `${fill(say.addresses, { count: s.count.toLocaleString("en-GB") })} ›`, pick: () => void expand(s.id) }
      : { label: s.suggestion, pick: () => void resolve(s.id) };
  }
  async function suggestAddresses(q: string): Promise<boolean> {
    try {
      const r = await call((signal) => addresses.suggest(q, { limit: 10 }, { signal }));
      if (!r) return true;
      if (mode === null && key) modes.set(key, (mode = "address"));
      const first = r.data[0];
      // A full postcode opens straight onto its addresses.
      if (first?.kind === "container" && first.type === "postcode" && formatPostcode(q)) await expand(first.id);
      else open(r.data.map(containerItem));
      return true;
    } catch (e) {
      const code = e instanceof APIError ? e.code : null;
      if (code === "address_lookup_not_enabled" || code === "key_required" || code === "address_credits_exhausted" || code === "publishable_key_not_allowed") {
        if (key) modes.set(key, (mode = "postcode"));
        return false;
      }
      close();
      return true;
    }
  }
  async function expand(container: string): Promise<void> {
    try {
      const r = await call((signal) => addresses.suggest("", { container, limit: 100 }, { signal }));
      if (r) open(r.data.map(containerItem));
    } catch (e) {
      failed(e);
    }
    input!.focus();
  }
  async function resolve(id: string): Promise<void> {
    try {
      const r = await call((signal) => addresses.retrieve(id, { signal }));
      if (!r) return;
      const a = r.data;
      // Lines and town are set exactly (a shorter address clears the old lines); an organisation the customer typed stays.
      for (const f of Object.keys(ADDRESS) as (keyof typeof ADDRESS)[]) put(f, ADDRESS[f][1](a) || (f === "organisation" || f === "udprn" ? null : ""));
      if (!(Object.keys(RECORD) as RecordField[]).some((f) => field(f))) clearRecord();
      show(fill(say.filled, { address: [a.line_1, a.line_2, a.post_town, a.postcode].filter(Boolean).join(", ") }), "ok");
      options.onAddress?.(a);
      if ((Object.keys(RECORD) as RecordField[]).some((f) => field(f))) {
        const rec = await call((signal) => postcodes.lookup(a.postcode, { fields: wanted() }, { signal })).catch(() => undefined);
        if (rec) for (const f of Object.keys(RECORD) as RecordField[]) put(f, RECORD[f][1](rec.data as Rec));
      }
    } catch (e) {
      failed(e);
    }
  }

  // ----------------------------------------------------------------------------------------------------- typing
  function typed(value: string, chosen = false): void {
    if (chosen) {
      selfEdit = true;
      setValue(input!, value);
      selfEdit = false;
      input!.focus();
    }
    clearTimeout(timer);
    const q = value.replace(/\s+/g, " ").trimStart();
    const pc = formatPostcode(q);
    show("", "");
    if (mode !== "address" && pc) {
      close();
      if (mode === null) timer = setTimeout(() => void suggestAddresses(q).then((ok) => ok || pick(pc)), 150);
      else pick(pc);
      return;
    }
    if (q.trim().length < 2 || (mode !== "postcode" && q.trim().length < 3)) {
      pending?.abort();
      return close();
    }
    timer = setTimeout(async () => {
      if (mode !== "postcode" && (await suggestAddresses(q))) return;
      void suggestPostcodes(q);
    }, 150);
  }

  function onInput(): void {
    if (selfEdit) return;
    const el = input!;
    const v = el.value;
    if (mode !== "address" && /[a-z]/.test(v) && PARTIAL.test(v)) {
      // Upper case as it is typed, keeping the caret where it was.
      const [a, b] = [el.selectionStart, el.selectionEnd];
      el.value = v.toUpperCase();
      el.setSelectionRange(a, b);
    }
    const pc = formatPostcode(el.value);
    if (mode !== "address" && pc && pc !== el.value && el.selectionStart === el.value.length) el.value = pc;
    typed(el.value);
  }
  function onKey(e: KeyboardEvent): void {
    const openNow = !list.hidden;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!openNow) return;
      e.preventDefault();
      move(e.key === "ArrowDown" ? active + 1 : active < 0 ? items.length - 1 : active - 1);
    } else if (e.key === "Enter" && openNow && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape" && openNow) {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") close();
  }
  function onBlur(): void {
    close();
    const v = input!.value.trim();
    if (v && mode === "postcode" && !formatPostcode(v)) show(say.invalid, "error");
  }
  const keep = (e: Event) => e.preventDefault(); // a click on the list keeps the focus in the input

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKey);
  input.addEventListener("blur", onBlur);
  list.addEventListener("mousedown", keep);

  return {
    get mode() {
      return mode;
    },
    destroy() {
      clearTimeout(timer);
      pending?.abort();
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKey);
      input.removeEventListener("blur", onBlur);
      list.remove();
      status.remove();
      sr.remove();
      for (const [a, v] of before) {
        if (v === null) input.removeAttribute(a);
        else input.setAttribute(a, v);
      }
      delete input.dataset.cpw;
    },
  };
}
