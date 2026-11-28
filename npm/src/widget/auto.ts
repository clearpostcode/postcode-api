/**
 * widget.js: one script tag adds the finder to every postcode field on the page.
 *   <link rel="stylesheet" href=".../widget.css">
 *   <script src=".../widget.js" data-key="cp_pub_..." defer></script>
 * Attributes: data-key (publishable key, optional), data-mode (auto | postcode | address), data-selector (which inputs),
 * data-base-url, data-auto="false" (attach nothing; call ClearPostcodeFinder.attach yourself).
 */
import { attach, formatPostcode, MESSAGES } from "./finder.ts";
import { watch } from "./index.ts";
import { VERSION } from "../version.ts";

const script = document.currentScript as HTMLScriptElement | null;
const d = script?.dataset ?? {};
const api = { attach, watch, formatPostcode, MESSAGES, version: VERSION };
(window as unknown as { ClearPostcodeFinder: typeof api }).ClearPostcodeFinder = api;

if (d.auto !== "false") {
  const start = () => watch({ key: d.key, mode: d.mode as "auto" | "postcode" | "address" | undefined, selector: d.selector, baseUrl: d.baseUrl });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
