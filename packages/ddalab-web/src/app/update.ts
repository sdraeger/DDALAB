// The service worker (public/sw.js) in production builds: its registration, and the new version that is ready for this
// window to switch to: at once on the start screen, else when the user asks (`updateReady` in the store, which
// UpdateNotice reads).
import { type UpdateCheck, useStore } from "../store/store";

const HOUR_MS = 3_600_000;
/** A window shown again checks at most this often. */
const SHOWN_MS = 600_000;
/** The least time a check by the user says "Checking". */
const CHECKING_MS = 800;

/** The worker a click on Reload switches to: a waiting one, or the one that took over in another window. */
let target: ServiceWorker | null = null;
/** Set by `applyUpdate`: the next change of controller is the one this page asked for. */
let reloading = false;
/** The registration of this page's worker, once registered. */
let registration: ServiceWorkerRegistration | null = null;
let lastCheck = 0;

/** What the last check found, as About and the library's footer say it. */
export const CHECK_TEXT: Record<UpdateCheck, string> = {
  idle: "",
  checking: "Checking for updates",
  current: "Up to date",
  found: "A new version is ready",
  failed: "Could not reach the server",
  unavailable: "This build does not update itself",
};

/**
 * Asks the host for a newer worker, at the user's request. A new one installs and is offered (`offer`); `updateCheck`
 * in the store says what the check found. The automatic checks (`look`) say nothing.
 */
export async function checkForUpdate() {
  if (!registration) return useStore.setState({ updateCheck: "unavailable" });
  useStore.setState({ updateCheck: "checking" });
  lastCheck = Date.now();
  // A check often answers within a frame: "Checking" stays long enough to read rather than flicker.
  const shown = new Promise((resolve) => setTimeout(resolve, CHECKING_MS));
  let check: UpdateCheck;
  try {
    await registration.update();
    const found = registration.installing ?? registration.waiting;
    check = found || useStore.getState().updateReady ? "found" : "current";
  } catch {
    check = "failed";
  }
  await shown;
  useStore.setState({ updateCheck: check });
}

/**
 * Makes `worker` the version to switch to. With no recording open and no run, nothing is lost by a reload: it switches
 * at once, or a reload of the browser's own would keep the old version (a waiting worker takes over only once every
 * window of the old one has closed). Otherwise the notice offers it.
 */
const offer = (worker: ServiceWorker | null) => {
  target = worker;
  const { recordings, run } = useStore.getState();
  if (Object.keys(recordings).length === 0 && run?.status !== "running") applyUpdate();
  else useStore.setState({ updateReady: true });
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
  // Under load WebKit reports the first install as waiting once it already controls the page: that is no new version.
  const check = ({ waiting }: ServiceWorkerRegistration) => {
    if (waiting && serviceWorker.controller && waiting !== serviceWorker.controller) offer(waiting);
  };
  serviceWorker.register("./sw.js", { scope: "./" }).then(
    (registered) => {
      registration = registered;
      lastCheck = Date.now();
      check(registered);
      registered.addEventListener("updatefound", () => {
        const installing = registered.installing;
        installing?.addEventListener(
          "statechange",
          () => installing.state === "installed" && check(registered),
        );
      });
      // A window that stays open has no navigation for the browser to check on: ask once an hour while it shows, and
      // when it is shown again after a while.
      const look = () => {
        lastCheck = Date.now();
        registered.update().catch(() => {});
      };
      setInterval(() => {
        if (document.visibilityState === "visible") look();
      }, HOUR_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && Date.now() - lastCheck > SHOWN_MS) look();
      });
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
