// The service worker (public/sw.js) in production builds: its registration, and the new version that waits to take over.
import { useSyncExternalStore } from "react";

let waiting: ServiceWorker | null = null;
/** Set by `applyUpdate`: the next change of controller is the one the user asked for, which reloads the page. */
let reloading = false;
const listeners = new Set<() => void>();

function setWaiting(worker: ServiceWorker | null) {
  waiting = worker;
  for (const listener of listeners) listener();
}

/**
 * Registers the worker beside index.html, for the folder the app is served from. A browser without service workers, a
 * refused registration and a first visit with no network leave the app running online as before.
 */
export function registerWorker() {
  const { serviceWorker } = navigator;
  if (!serviceWorker) return;
  // A waiting worker is an update only when another one controls the page: the first install activates at once.
  const check = (registration: ServiceWorkerRegistration) => {
    if (registration.waiting && serviceWorker.controller) setWaiting(registration.waiting);
  };
  serviceWorker.register("./sw.js", { scope: "./" }).then(
    (registration) => {
      check(registration);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener(
          "statechange",
          () => installing.state === "installed" && check(registration),
        );
      });
    },
    () => {},
  );
  serviceWorker.addEventListener("controllerchange", () => reloading && location.reload());
}

/** Lets the waiting version take over; the page reloads once it has. */
export function applyUpdate() {
  reloading = true;
  waiting?.postMessage("skipWaiting");
}

/** Whether a new version is installed and waits for `applyUpdate`. */
export const useUpdateWaiting = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => waiting !== null,
  );
