import { afterEach, expect, test, vi } from "vitest";
import { ask, isUnresponsive, permitted } from "./handles";

afterEach(() => {
  vi.useRealTimers();
});

test("a_hanging_queryPermission_times_out_and_marks_the_handle_unresponsive", async () => {
  vi.useFakeTimers();
  const requestPermission = vi.fn(() => new Promise<PermissionState>(() => {}));
  const handle = {
    kind: "directory",
    name: "data",
    queryPermission: () => new Promise<PermissionState>(() => {}),
    requestPermission,
  } as unknown as FileSystemDirectoryHandle;

  const pending = permitted(handle);
  await vi.advanceTimersByTimeAsync(1100);
  expect(await pending).toBe(false);
  expect(isUnresponsive(handle)).toBe(true);

  // Subsequent calls short-circuit immediately without waiting or invoking requestPermission.
  expect(await permitted(handle)).toBe(false);
  expect(await ask(handle)).toBe("unresponsive");
  expect(requestPermission).not.toHaveBeenCalled();
});
