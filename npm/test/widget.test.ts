import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const window = new Window({ url: "https://shop.example/checkout" });
const g = globalThis as Record<string, unknown>;
for (const k of ["document", "Event", "KeyboardEvent", "HTMLElement", "MutationObserver", "Document", "Node"]) g[k] = (window as unknown as Record<string, unknown>)[k];

const { attach, watch, formatPostcode } = await import("../src/widget/index.ts");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const META = { edition: "2026-08" };
const ok = (data: unknown) => new Response(JSON.stringify({ data, meta: META }), { status: 200, headers: { "content-type": "application/json" } });
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ type: `https://clearpostcode.co.uk/developers/docs/errors#${code}`, title: code, status, detail: "d", instance: "/v1/x", request_id: "rid", ...extra }), { status });

const RECORD = { postcode: "SW1A 1AA", status: "live", replaced_by: null, local_authority: { code: "E09000033", name: "Westminster" }, county: null, constituency: { code: "E14001172", name: "Cities of London and Westminster" } };

type Handler = (url: URL) => Response;
function api(handler: Handler) {
  const calls: URL[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    calls.push(u);
    return handler(u);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
const postcodeApi = () =>
  api((u) => {
    if (u.pathname === "/v1/autocomplete") return ok(u.searchParams.get("q")!.trim().length <= 4 ? [{ type: "district", outcode: "SW1A", postcodes: 145 }] : [{ type: "postcode", postcode: "SW1A 1AA" }, { type: "postcode", postcode: "SW1A 1AB" }]);
    const pc = decodeURIComponent(u.pathname.split("/").pop()!);
    if (pc === "SW1A 1AA" || pc === "SW1A 1AB") return ok({ ...RECORD, postcode: pc });
    if (pc === "AB1 0AA") return ok({ postcode: "AB1 0AA", status: "terminated", replaced_by: "AB10 1AA", local_authority: { code: "S1", name: "Aberdeen City" } });
    if (pc === "AB10 1AA") return ok({ postcode: "AB10 1AA", status: "live", replaced_by: null, local_authority: { code: "S1", name: "Aberdeen City" } });
    if (pc.startsWith("BT")) return problem(404, "not_covered");
    return problem(404, "postcode_not_found");
  });

function form(html: string) {
  document.body.innerHTML = `<form>${html}</form>`;
  return document.body;
}
function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const key = (input: HTMLInputElement, k: string) => input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const $ = <T extends Element = HTMLInputElement>(s: string) => document.querySelector(s) as unknown as T;
const statusOf = (input: HTMLInputElement) => document.getElementById(input.getAttribute("aria-describedby")!.split(" ").pop()!)!;
const listOf = (input: HTMLInputElement) => document.getElementById(input.getAttribute("aria-controls")!)!;

beforeEach(() => {
  document.body.innerHTML = "";
});

test("formatPostcode: the API's format, canonical spacing and case", () => {
  assert.equal(formatPostcode("sw1a1aa"), "SW1A 1AA");
  assert.equal(formatPostcode(" m1  1ae "), "M1 1AE");
  assert.equal(formatPostcode("ZZ1 1ZZ"), null);
  assert.equal(formatPostcode("SW1A"), null);
});

test("the input becomes an ARIA combobox with a listbox and a polite status", () => {
  form(`<input id="pc" autocomplete="postal-code">`);
  const input = $("#pc");
  attach(input, { fetch: postcodeApi().fetch });
  assert.equal(input.getAttribute("role"), "combobox");
  assert.equal(input.getAttribute("aria-autocomplete"), "list");
  assert.equal(input.getAttribute("aria-expanded"), "false");
  assert.equal(listOf(input).getAttribute("role"), "listbox");
  assert.equal(statusOf(input).getAttribute("role"), "status");
});

test("postcode mode: formats as typed, checks the postcode, says the council and fills the fields the record holds", async () => {
  form(`<input id="pc" autocomplete="postal-code"><input id="council" data-clearpostcode="council"><input id="seat" data-clearpostcode="constituency"><input id="county" data-clearpostcode="county" value="kept">`);
  const { fetch, calls } = postcodeApi();
  const seen: string[] = [];
  const input = $("#pc");
  attach(input, { fetch, onPostcode: (r) => seen.push(r.postcode) });
  type(input, "sw1a1aa");
  assert.equal(input.value, "SW1A 1AA");
  await sleep(20);
  const lookup = calls.at(-1)!;
  assert.equal(lookup.pathname, "/v1/postcodes/SW1A%201AA");
  assert.deepEqual(lookup.searchParams.get("fields")!.split(",").sort(), ["constituency", "county", "local_authority", "replaced_by"]);
  assert.equal(lookup.searchParams.get("key"), null, "keyless: no key at all");
  assert.equal(statusOf(input).textContent, "SW1A 1AA · Westminster");
  assert.equal(statusOf(input).dataset.state, "ok");
  assert.equal($("#council").value, "Westminster");
  assert.equal($("#seat").value, "Cities of London and Westminster");
  assert.equal($("#county").value, "kept", "a field the record leaves empty is left alone");
  assert.deepEqual(seen, ["SW1A 1AA"]);
});

test("nothing from the last postcode outlives the next: the finder clears only what it filled", async () => {
  form(`<input id="pc" autocomplete="postal-code"><input id="council" data-clearpostcode="council"><input id="seat" data-clearpostcode="constituency">`);
  const input = $("#pc");
  attach(input, { fetch: postcodeApi().fetch });
  type(input, "SW1A 1AA");
  await sleep(20);
  assert.equal($("#council").value, "Westminster");
  $("#seat").value = "Typed by hand";
  type(input, "AB1 0AA");
  await sleep(20);
  assert.equal($("#council").value, "", "the council of the previous postcode is cleared");
  assert.equal($("#seat").value, "Typed by hand", "a value the customer typed stays");
});

test("a target that is not a form field shows the value as text", async () => {
  form(`<input id="pc" autocomplete="postal-code"><dl><dt>Council</dt><dd id="council" data-clearpostcode="council"></dd></dl>`);
  const input = $("#pc");
  attach(input, { fetch: postcodeApi().fetch });
  type(input, "SW1A 1AA");
  await sleep(20);
  assert.equal($<HTMLElement>("#council").textContent, "Westminster");
  type(input, "SW1A 9ZZ");
  await sleep(20);
  assert.equal($<HTMLElement>("#council").textContent, "");
});

test("suggestions: the list opens, arrows move the active option, Enter picks, Escape closes", async () => {
  form(`<input id="pc" autocomplete="postal-code">`);
  const { fetch, calls } = postcodeApi();
  const input = $("#pc");
  attach(input, { fetch });
  type(input, "SW1A 1");
  await sleep(200);
  const list = listOf(input);
  assert.equal(list.hidden, false);
  assert.equal(input.getAttribute("aria-expanded"), "true");
  assert.equal(list.children.length, 2);
  key(input, "ArrowDown");
  key(input, "ArrowDown");
  assert.equal(input.getAttribute("aria-activedescendant"), list.children[1]!.id);
  assert.equal(list.children[1]!.getAttribute("aria-selected"), "true");
  key(input, "Enter");
  assert.equal(input.value, "SW1A 1AB");
  assert.equal(list.hidden, true);
  await sleep(20);
  assert.equal(calls.at(-1)!.pathname, "/v1/postcodes/SW1A%201AB");
  type(input, "SW1A 1");
  await sleep(200);
  key(input, "Escape");
  assert.equal(list.hidden, true);
  assert.equal(input.getAttribute("aria-expanded"), "false");
});

test("a district suggestion fills the outward code and keeps suggesting", async () => {
  form(`<input id="pc" autocomplete="postal-code">`);
  const { fetch, calls } = postcodeApi();
  const input = $("#pc");
  attach(input, { fetch });
  type(input, "SW1");
  await sleep(200);
  assert.match(listOf(input).children[0]!.textContent!, /SW1A.*145 postcodes/);
  (listOf(input).children[0] as HTMLElement).click();
  assert.equal(input.value, "SW1A ");
  await sleep(200);
  assert.equal(calls.at(-1)!.searchParams.get("q"), "SW1A ");
});

test("unknown, retired, Northern Ireland and badly formed postcodes each get a clear message", async () => {
  form(`<input id="pc" autocomplete="postal-code">`);
  const { fetch } = postcodeApi();
  const input = $("#pc");
  attach(input, { fetch });
  type(input, "SW1A 9ZZ");
  await sleep(20);
  assert.match(statusOf(input).textContent!, /SW1A 9ZZ isn't in the postcode data/);
  assert.equal(input.getAttribute("aria-invalid"), null, "an unknown postcode is never marked invalid");
  type(input, "AB1 0AA");
  await sleep(20);
  assert.match(statusOf(input).textContent!, /no longer in use\. The nearest live postcode is AB10 1AA/);
  const use = statusOf(input).querySelector("button")!;
  assert.equal(use.textContent, "Use AB10 1AA");
  use.click();
  assert.equal(input.value, "AB10 1AA");
  await sleep(20);
  assert.equal(statusOf(input).textContent, "AB10 1AA · Aberdeen City");
  type(input, "BT1 1AA");
  await sleep(20);
  assert.match(statusOf(input).textContent!, /Northern Ireland postcode/);
  type(input, "ZZ9");
  input.dispatchEvent(new Event("blur"));
  assert.equal(statusOf(input).textContent, "Enter a full UK postcode, like SW1A 1AA.");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  type(input, "ZZ8");
  document.dispatchEvent(new window.PointerEvent("pointerdown") as unknown as Event);
  input.dispatchEvent(new Event("blur"));
  assert.equal(statusOf(input).textContent, "", "a press elsewhere: nothing moves under the pointer yet");
  document.dispatchEvent(new window.PointerEvent("pointerup") as unknown as Event);
  await sleep(10);
  assert.equal(statusOf(input).textContent, "Enter a full UK postcode, like SW1A 1AA.");
});

const PUB = `cp_pub_${"a".repeat(32)}`;
const ADDRESS = { udprn: "90000001", umprn: null, uprn: null, line_1: "Flat 2", line_2: "2 High Street", line_3: "", post_town: "PORTHMORE", postcode: "ZZ9 9ZZ", organisation_name: "", department_name: "", sub_building_name: "Flat 2", building_name: "", building_number: "2", dependant_thoroughfare: "", thoroughfare: "High Street", double_dependant_locality: "", dependant_locality: "", po_box: "" };

test("address mode: suggestions, a container's addresses, then the address fills the form", async () => {
  form(`<input id="pc" autocomplete="postal-code"><input id="l1" autocomplete="address-line1"><input id="l2" autocomplete="address-line2" value="old"><input id="l3" autocomplete="address-line3" value="old"><input id="town" autocomplete="address-level2"><input id="org" autocomplete="organization" value="Typed Ltd">`);
  const { fetch, calls } = api((u) => {
    if (u.pathname === "/v1/addresses/suggest" && u.searchParams.get("container")) return ok([{ kind: "address", id: "a1", suggestion: "Flat 2, 2 High Street, Porthmore" }]);
    if (u.pathname === "/v1/addresses/suggest") return ok([{ kind: "container", id: "c1", suggestion: "High Street, Porthmore", type: "street", count: 24 }]);
    if (u.pathname === "/v1/addresses/retrieve/a1") return ok(ADDRESS);
    return problem(404, "not_found");
  });
  const got: string[] = [];
  const input = $("#pc");
  const finder = attach(input, { key: PUB, fetch, onAddress: (a) => got.push(a.udprn) });
  type(input, "2 High Street");
  await sleep(200);
  assert.equal(finder.mode, "address");
  assert.equal(calls[0]!.searchParams.get("key"), PUB);
  const list = listOf(input);
  assert.match(list.textContent!, /High Street, Porthmore.*24 addresses/);
  (list.children[0] as HTMLElement).click();
  await sleep(20);
  assert.equal(calls[1]!.searchParams.get("container"), "c1");
  (list.children[0] as HTMLElement).click();
  await sleep(20);
  assert.equal($("#l1").value, "Flat 2");
  assert.equal($("#l2").value, "2 High Street");
  assert.equal($("#l3").value, "", "a line the address does not have is cleared");
  assert.equal($("#town").value, "PORTHMORE");
  assert.equal(input.value, "ZZ9 9ZZ");
  assert.equal($("#org").value, "Typed Ltd", "an organisation the customer typed stays");
  assert.equal(statusOf(input).textContent, "Address filled: Flat 2, 2 High Street, PORTHMORE, ZZ9 9ZZ");
  assert.deepEqual(got, ["90000001"]);
});

test("a full postcode in address mode opens straight onto its addresses", async () => {
  form(`<input id="pc" autocomplete="postal-code">`);
  const { fetch, calls } = api((u) =>
    u.searchParams.get("container") ? ok([{ kind: "address", id: "a1", suggestion: "1 Test Road" }]) : ok([{ kind: "container", id: "pc-1", suggestion: "AB10 1AA", type: "postcode", count: 12 }]),
  );
  const input = $("#pc");
  attach(input, { key: PUB, mode: "address", fetch });
  type(input, "AB10 1AA");
  await sleep(200);
  assert.equal(calls[1]!.searchParams.get("container"), "pc-1");
  assert.equal(listOf(input).children[0]!.textContent, "1 Test Road");
});

test("a key without Address lookup falls back to postcode mode, once for every finder with that key", async () => {
  const key = `cp_pub_${"b".repeat(32)}`;
  form(`<input id="pc" autocomplete="postal-code">`);
  const { fetch, calls } = api((u) => {
    if (u.pathname.startsWith("/v1/addresses")) return problem(403, "address_lookup_not_enabled");
    return u.pathname === "/v1/autocomplete" ? ok([{ type: "postcode", postcode: "SW1A 1AA" }]) : ok(RECORD);
  });
  const input = $("#pc");
  const finder = attach(input, { key, fetch });
  assert.equal(finder.mode, null);
  type(input, "SW1A 1");
  await sleep(250);
  assert.equal(finder.mode, "postcode");
  assert.deepEqual(calls.map((u) => u.pathname), ["/v1/addresses/suggest", "/v1/autocomplete"]);
  form(`<input id="pc2" autocomplete="postal-code">`);
  assert.equal(attach($("#pc2"), { key, fetch }).mode, "postcode");
});

test("a publishable key the API refuses is dropped: the finder carries on keyless", async () => {
  const refusedKey = `cp_pub_${"d".repeat(32)}`;
  form(`<input id="pc" autocomplete="postal-code">`);
  const { fetch, calls } = api((u) => (u.searchParams.get("key") ? problem(403, "origin_not_allowed") : ok(RECORD)));
  const warned: unknown[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void warned.push(a);
  try {
    const input = $("#pc");
    const finder = attach(input, { key: refusedKey, mode: "postcode", fetch });
    type(input, "SW1A 1AA");
    await sleep(30);
    assert.equal(statusOf(input).textContent, "SW1A 1AA · Westminster");
    assert.deepEqual(calls.map((u) => u.searchParams.has("key")), [true, false]);
    assert.equal(finder.mode, "postcode");
    assert.match(String((warned[0] as unknown[])[0]), /origin_not_allowed/);
    form(`<input id="pc2" autocomplete="postal-code">`);
    attach($("#pc2"), { key: refusedKey, fetch });
    type($("#pc2"), "SW1A 1AA");
    await sleep(30);
    assert.equal(calls.at(-1)!.searchParams.has("key"), false, "other finders with the key start keyless");
  } finally {
    console.warn = warn;
  }
});

test("billing and shipping in one form: each finder fills its own section", async () => {
  form(`<div class="billing"><input id="b" autocomplete="billing postal-code"><input id="bc" data-clearpostcode="council"></div><div class="shipping"><input id="s" autocomplete="shipping postal-code"><input id="sc" data-clearpostcode="council"></div>`);
  const { fetch } = api((u) => ok({ ...RECORD, postcode: decodeURIComponent(u.pathname.split("/").pop()!), local_authority: { code: "x", name: u.pathname.includes("M1") ? "Manchester" : "Westminster" } }));
  attach($("#b"), { fetch });
  attach($("#s"), { fetch });
  type($("#s"), "M1 1AE");
  await sleep(20);
  assert.equal($("#sc").value, "Manchester");
  assert.equal($("#bc").value, "");
});

test("a secret key is refused; destroy() leaves the input as it was", () => {
  form(`<input id="pc" autocomplete="postal-code" aria-describedby="hint">`);
  const input = $("#pc");
  assert.throws(() => attach(input, { key: `cp_live_${"c".repeat(32)}` }), /publishable key/);
  const f = attach(input, { fetch: postcodeApi().fetch });
  f.destroy();
  assert.equal(input.getAttribute("role"), null);
  assert.equal(input.getAttribute("aria-describedby"), "hint");
  assert.equal(document.querySelectorAll(".cpw-list, .cpw-status").length, 0);
});

test("watch() finds postcode fields now and as the page adds them", async () => {
  form(`<input id="a" autocomplete="postal-code"><input id="skip" type="hidden" autocomplete="postal-code">`);
  const w = watch({ fetch: postcodeApi().fetch, root: document });
  assert.equal(w.finders.length, 1);
  const late = document.createElement("input");
  late.setAttribute("data-clearpostcode", "postcode");
  document.body.append(late);
  await sleep(10);
  assert.equal(w.finders.length, 2);
  assert.equal(late.getAttribute("role"), "combobox");
  w.stop();
  assert.equal(late.getAttribute("role"), null);
});

test("React: <PostcodeFinder> renders the input with the finder and hands the record to the app", async () => {
  g.window = window;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  const { createElement, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { PostcodeFinder } = await import("../src/react.ts");
  const host = document.createElement("div");
  document.body.append(host);
  const got: string[] = [];
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(createElement(PostcodeFinder, { name: "postcode", placeholder: "Postcode", fetch: postcodeApi().fetch, onPostcode: (r) => got.push(r.postcode) })));
  const input = host.querySelector("input")!;
  assert.equal(input.getAttribute("role"), "combobox");
  assert.equal(input.getAttribute("name"), "postcode");
  await act(async () => {
    type(input as unknown as HTMLInputElement, "sw1a 1aa");
    await sleep(30);
  });
  assert.deepEqual(got, ["SW1A 1AA"]);
  await act(async () => root.unmount());
  assert.equal(document.querySelectorAll(".cpw-list").length, 0);
});
