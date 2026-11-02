import { afterEach, beforeEach, expect, test, vi } from "vitest";

/** A page controlled by an old worker, with a new one `waiting` at registration; what it posts and reloads. */
function page(waiting: boolean, found: unknown = null) {
  const posted: unknown[] = [];
  const worker = { postMessage: (m: unknown) => posted.push(m) };
  const registration = {
    waiting: waiting ? worker : null,
    installing: null as unknown,
    addEventListener() {},
    update: async () => {
      registration.installing = found;
    },
  };
  const reload = vi.fn();
  vi.stubGlobal("navigator", {
    serviceWorker: { controller: {}, register: async () => registration, addEventListener() {} },
  });
  vi.stubGlobal("location", { reload });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener() {} });
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

test("a_check_reports_whether_a_new_version_was_found", async () => {
  page(false, {});
  const { registerWorker, checkForUpdate, useStore } = await load();
  await checkForUpdate();
  expect(useStore.getState().updateCheck).toBe("unavailable");
  registerWorker();
  await new Promise((r) => setTimeout(r));
  await checkForUpdate();
  expect(useStore.getState().updateCheck).toBe("found");
});

test("a_check_with_no_new_version_says_up_to_date", async () => {
  page(false);
  const { registerWorker, checkForUpdate, useStore } = await load();
  registerWorker();
  await new Promise((r) => setTimeout(r));
  await checkForUpdate();
  expect(useStore.getState().updateCheck).toBe("current");
});
