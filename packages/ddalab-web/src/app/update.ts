// The service worker (public/sw.js) in production builds: its registration, and the new version that is ready for this
// window to switch to. Whether one is ready is `updateReady` in the store, which UpdateNotice reads.
import { useStore } from "../store/store";

const HOUR_MS = 3_600_000;

/** The worker a click on Reload switches to: a waiting one, or the one that took over in another window. */
let target: ServiceWorker | null = null;
/** Set by `applyUpdate`: the next change of controller is the one this page asked for. */
let reloading = false;

const offer = (worker: ServiceWorker | null) => {
  target = worker;
  useStore.setState({ updateReady: true });
};

/**
 * Registers the worker beside index.html, for the folder the app is served from. A browser without service workers, a
 * refused registration and a first visit with no network leave the app running online as before.
 */
export function registerWorker() {
  const { serviceWorker } = navigator;
  if (!serviceWorker) return;
  // Whether a worker has controlled this page: the first install claims it, which is no update.
  let controlled = Boolean(serviceWorker.controller);
  const check = (registration: ServiceWorkerRegistration) => {
    if (registration.waiting && serviceWorker.controller) offer(registration.waiting);
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
      // A window that stays open has no navigation for the browser to check on: ask once an hour while it shows.
      setInterval(() => {
        if (document.visibilityState === "visible") registration.update().catch(() => {});
      }, HOUR_MS);
    },
    () => {},
  );
  serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return location.reload();
    // Another window switched versions: the files of this page's version may have left the cache. Offer the reload.
    if (controlled && serviceWorker.controller) offer(serviceWorker.controller);
    controlled = true;
  });
}

/** Switches this window to the new version and reloads it: at once when that version is already active. */
export function applyUpdate() {
  reloading = true;
  if (target === navigator.serviceWorker.controller) location.reload();
  else target?.postMessage("skipWaiting");
}
