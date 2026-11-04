// The live stream's address check and how it keeps the newest samples and results.
import { expect, test } from "vitest";
import { LiveBuffer, liveAddress } from "./live";

test("an_address_is_a_local_websocket_with_its_token", () => {
  expect(liveAddress(" ws://127.0.0.1:8765/?token=abc ")).toBe("ws://127.0.0.1:8765/?token=abc");
  expect(liveAddress("ws://localhost:9000/?token=x")).toBe("ws://localhost:9000/?token=x");
  expect(() => liveAddress("ws://example.org:8765/?token=abc")).toThrow(/this computer/);
  expect(() => liveAddress("ws://127.0.0.1:8765/")).toThrow(/token/);
  expect(() => liveAddress("http://127.0.0.1:8765/?token=a")).toThrow(/ws:/);
});

test("the_buffer_keeps_the_newest_seconds_per_channel", () => {
  const header = { name: "EEG", channels: ["A", "B"], sample_rate_hz: 4, variants: { ST: ["A", "B"] } };
  const live = new LiveBuffer(header, 2); // 2 s at 4 Hz: 8 samples per channel
  live.samples(new Float32Array([0, 10, 1, 11, 2, 12]));
  expect(Array.from(live.channel(0))).toEqual([0, 1, 2]);
  live.samples(new Float32Array(Array.from({ length: 20 }, (_, i) => i)));
  expect(live.channel(1).length).toBe(8);
  expect(live.channel(1).at(-1)).toBe(19);
  live.result({ type: "dda", t: 1, variants: { ST: [0.5, -0.5] } });
  expect(live.results("ST")).toEqual([{ t: 1, values: [0.5, -0.5] }]);
});
