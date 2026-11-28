/**
 * The ClearPostcode finder: a postcode (and, with Address lookup, address) finder for any form. ESM and CommonJS here;
 * dist/widget.js is the same as one file for a script tag, with dist/widget.css beside it.
 */
import { attach, type Finder, type FinderOptions } from "./finder.ts";

export { attach, formatPostcode, MESSAGES } from "./finder.ts";
export type { FieldName, Finder, FinderOptions, Messages } from "./finder.ts";

/** The inputs a finder goes on when no selector is given: marked ones, else every postcode field. */
export const DEFAULT_SELECTOR = '[data-clearpostcode="postcode"], input[autocomplete~="postal-code"]';

/**
 * Put a finder on every matching input, now and as the page adds more (checkout pages often render their fields after
 * load). Returns the finders made so far and stop(), which removes them all.
 */
export function watch(options: FinderOptions & { selector?: string; root?: ParentNode } = {}): { finders: Finder[]; stop(): void } {
  const { selector = DEFAULT_SELECTOR, root = document, ...finderOptions } = options;
  const finders: Finder[] = [];
  const scan = () => {
    for (const el of root.querySelectorAll<HTMLInputElement>(selector)) {
      if (el.dataset.cpw || el.tagName !== "INPUT" || el.type === "hidden") continue;
      finders.push(attach(el, finderOptions));
    }
  };
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(root instanceof Document ? root.documentElement : (root as Node), { childList: true, subtree: true });
  return {
    finders,
    stop() {
      observer.disconnect();
      finders.splice(0).forEach((f) => f.destroy());
    },
  };
}
