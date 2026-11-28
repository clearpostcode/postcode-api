/**
 * The finder for React: <PostcodeFinder> renders the input and wires the finder to it; usePostcodeFinder() puts the
 * finder on an input you render. Callbacks hand you the record or the address, so controlled forms set their own
 * state; fields named in `fields` (or found in the form) are filled as well.
 */
import { createElement, useEffect, useRef, type InputHTMLAttributes, type ReactElement, type RefObject } from "react";
import { attach, type FinderOptions } from "./widget/finder.ts";

/**
 * Put the finder on the input in `ref` (its list and message go in `mount` when given). It is rebuilt only when the
 * key, mode or base URL change; the callbacks can change on every render.
 */
export function usePostcodeFinder(ref: RefObject<HTMLInputElement | null>, options: FinderOptions = {}, mount?: RefObject<HTMLElement | null>): void {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const o = latest.current;
    const finder = attach(input, {
      ...o,
      mount: o.mount ?? mount?.current ?? undefined,
      onPostcode: (r) => latest.current.onPostcode?.(r),
      onAddress: (a) => latest.current.onAddress?.(a),
      onError: (e) => latest.current.onError?.(e),
    });
    return () => finder.destroy();
  }, [ref, mount, options.key, options.mode, options.baseUrl]);
}

export type PostcodeFinderProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onError"> &
  Omit<FinderOptions, "mount" | "key"> & {
    /** Your publishable key (cp_pub_). Optional in postcode mode; Address lookup needs it. */
    publishableKey?: string;
  };

/** A postcode input with the finder on it. Input props (name, id, placeholder, className…) pass through. */
export function PostcodeFinder({ publishableKey, mode, fields, messages, onPostcode, onAddress, onError, baseUrl, fetch, ...input }: PostcodeFinderProps): ReactElement {
  const ref = useRef<HTMLInputElement | null>(null);
  const slot = useRef<HTMLDivElement | null>(null);
  usePostcodeFinder(ref, { key: publishableKey, mode, fields, messages, onPostcode, onAddress, onError, baseUrl, fetch }, slot);
  return createElement(
    "div",
    { className: "cpw-react", style: { position: "relative" } },
    createElement("input", { type: "text", autoComplete: "postal-code", spellCheck: false, ...input, ref }),
    createElement("div", { ref: slot }),
  );
}
