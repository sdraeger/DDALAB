import { afterEach, beforeEach, expect, test, vi } from "vitest";

/** A page controlled by an old worker, with a new one `waiting` at registration; what it posts and reloads. */
function page(waiting: boolean) {
  const posted: unknown[] = [];
  const worker = { postMessage: (m: unknown) => posted.push(m) };
  const registration = {
    waiting: waiting ? worker : null,
    installing: null,
    addEventListener() {},
    update: async () => {},
  };
  const reload = vi.fn();
  vi.stubGlobal("navigator", {
    serviceWorker: { controller: {}, register: async () => registration, addEventListener() {} },
  });
  vi.stubGlobal("location", { reload });
  vi.stubGlobal("document", { visibilityState: "visible" });
  return { posted, reload };
}

// Each test has its own update.ts (its `target` and `reloading`) and store.
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

const load = async () => ({ ...(await import("./update")), ...(await import("../store/store")) });

test("a_new_version_on_the_start_screen_takes_over_at_once", async () => {
  const { posted } = page(true);
  const { registerWorker } = await load();
  registerWorker();
  await vi.waitFor(() => expect(posted).toEqual(["skipWaiting"]));
});

test("a_new_version_with_a_recording_open_waits_for_reload", async () => {
  const { posted } = page(true);
  const { registerWorker, useStore } = await load();
  useStore.setState({ recordings: { a: {} as never } });
  registerWorker();
  await vi.waitFor(() => expect(useStore.getState().updateReady).toBe(true));
  expect(posted).toEqual([]);
});
