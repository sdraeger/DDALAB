// Hooks on CSS media queries that re-render when the answer changes.
import { useSyncExternalStore } from "react";

/** One subscribe function per query, so React keeps its subscription across renders. */
const subscribers = new Map<string, (onChange: () => void) => () => void>();
const subscriber = (query: string) => {
  let subscribe = subscribers.get(query);
  if (!subscribe) {
    subscribe = (onChange) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    };
    subscribers.set(query, subscribe);
  }
  return subscribe;
};

/** Whether the media query `query` matches now. */
export const useMedia = (query: string) =>
  useSyncExternalStore(subscriber(query), () => matchMedia(query).matches);

/** A phone: a window below 768 px, where the workspace shows one view at a time (Shell.module.css). */
export const usePhone = () => useMedia("(width < 768px)");

const FINE = { one: 28, two: 40 };
const TOUCH = { one: 40, two: 52 };

/**
 * The hit sizes of tokens.css (--hit, --hit-two) for lists that place their rows in code: the heights of a one-line
 * and a two-line row in CSS pixels, 28 and 40, or 40 and 52 under a coarse pointer (a touch screen); the same object
 * until the pointer changes.
 */
export const useHit = () => (useMedia("(pointer: coarse)") ? TOUCH : FINE);
