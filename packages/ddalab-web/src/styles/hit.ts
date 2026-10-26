// The hit sizes of tokens.css (--hit, --hit-two) for lists that place their rows in code: 28 and 40 px, or 40 and
// 52 px under a coarse pointer (a touch screen). A tablet that gains or loses a mouse switches between them.
import { useSyncExternalStore } from "react";

const coarse = () => matchMedia("(pointer: coarse)");
const subscribe = (onChange: () => void) => {
  const query = coarse();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

const FINE = { one: 28, two: 40 };
const TOUCH = { one: 40, two: 52 };

/** The heights of a one-line and a two-line row, in CSS pixels; the same object until the pointer changes. */
export function useHit() {
  return useSyncExternalStore(subscribe, () => coarse().matches) ? TOUCH : FINE;
}
