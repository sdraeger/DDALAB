import "fake-indexeddb/auto";
import { beforeEach, expect, test, vi } from "vitest";
import { database } from "./recent";
import { candidates, claimWindow, reopenable, type SavedWindow, sessionKey, windowKey } from "./windows";

const saved = (used: number, names: string[]): SavedWindow => ({
  tabs: names.map((name) => ({ fingerprint: name, name, source: null })),
  active: names[0] ?? null,
  used,
});
const names = (window?: SavedWindow) => window?.tabs.map((t) => t.name);

/** The window locks other windows hold. */
const held = new Set<string>();
const storage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
};
/** A window starting at `url`, with the sessionStorage of a fresh launch unless given one. */
function launch(url = "https://example.test/app/", session = storage()) {
  vi.stubGlobal("location", new URL(url));
  vi.stubGlobal("sessionStorage", session);
  return claimWindow();
}

beforeEach(async () => {
  held.clear();
  vi.stubGlobal("navigator", {
    locks: {
      query: async () => ({ held: [...held].map((name) => ({ name })), pending: [] }),
      request: async (name: string, _options: unknown, grant: (lock: unknown) => unknown) => {
        if (held.has(name)) return grant(null);
        held.add(name);
        return grant({ name });
      },
    },
  });
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("history", { state: null, replaceState() {} });
  await (await database()).clear("tabs");
});

const put = async (id: string, window: SavedWindow) => (await database()).put("tabs", window, `window:${id}`);

test("candidates_are_the_own_window_then_the_unheld_ones_with_tabs_used_last_first", () => {
  const all = new Map([
    ["a", saved(1, ["a.edf"])],
    ["b", saved(3, ["b.edf"])],
    ["c", saved(2, ["c.edf"])],
    ["empty", saved(4, [])],
  ]);
  expect(candidates(null, all, new Set(["b"]))).toEqual(["c", "a"]);
  expect(candidates("a", all, new Set(["b"]))).toEqual(["a", "c"]);
});

test("a_fresh_launch_claims_the_newest_unheld_window_and_skips_a_held_one", async () => {
  await put("a", saved(1, ["a.edf"]));
  await put("b", saved(3, ["b.edf"]));
  await put("c", saved(2, ["c.edf"]));
  held.add("ddalab-window:b");
  const session = storage();
  expect(names(await launch(undefined, session))).toEqual(["c.edf"]);
  expect(windowKey()).toBe("window:c");
  expect(session.getItem("ddalab.window")).toBe("c");
  // The next launch takes the one left; then none is left to reopen.
  expect(names(await launch())).toEqual(["a.edf"]);
  expect(await reopenable()).toEqual([]);
  held.delete("ddalab-window:a");
  expect((await reopenable()).map(([id]) => id)).toEqual(["a"]);
});

test("a_reload_keeps_its_window_and_reopen_and_new_window_ask_by_url", async () => {
  await put("a", saved(1, ["a.edf"]));
  await put("b", saved(2, ["b.edf"]));
  const session = storage();
  session.setItem("ddalab.window", "a");
  expect(names(await launch(undefined, session))).toEqual(["a.edf"]);
  expect(names(await launch("https://example.test/app/?window=new"))).toBeUndefined();
  expect(names(await launch("https://example.test/app/?window=b"))).toEqual(["b.edf"]);
});

test("the_single_saved_set_of_2_1_becomes_the_window_the_first_launch_claims", async () => {
  const db = await database();
  await db.put("tabs", { tabs: saved(0, ["old.edf"]).tabs, active: "old.edf" }, "open");
  const session = JSON.stringify({ panels: { library: false, inspector: true }, activeResultId: "r1" });
  localStorage.setItem("ddalab.session", session);
  expect(await launch()).toMatchObject({ tabs: [{ name: "old.edf" }], active: "old.edf" });
  expect(localStorage.getItem(sessionKey())).toBe(session);
  expect(await db.get("tabs", "open")).toBeUndefined();
  expect(localStorage.getItem("ddalab.session")).toBeNull();
});

test("saved_windows_without_tabs_are_not_kept_unless_held", async () => {
  await put("empty", saved(5, []));
  await put("busy", saved(6, []));
  localStorage.setItem(sessionKey("empty"), "{}");
  held.add("ddalab-window:busy");
  expect(await launch()).toBeUndefined();
  const db = await database();
  expect(await db.get("tabs", "window:empty")).toBeUndefined();
  expect(localStorage.getItem(sessionKey("empty"))).toBeNull();
  expect(await db.get("tabs", "window:busy")).toBeDefined();
});
