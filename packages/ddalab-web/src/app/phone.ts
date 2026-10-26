// A phone: a window below 768 px, where the workspace shows one view at a time (Shell.module.css). Shell.tsx follows it
// to point the Inspector button at the phone's own inspector state.
import { useSyncExternalStore } from "react";

const narrow = () => matchMedia("(width < 768px)");
const subscribe = (onChange: () => void) => {
  const query = narrow();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

export const usePhone = () => useSyncExternalStore(subscribe, () => narrow().matches);
