import { expect, test } from "vitest";
import { count, decimal } from "./words";

test("counts_agree_with_their_number", () => {
  expect(count(1, "channel")).toBe("1 channel");
  expect(count(0, "channel")).toBe("0 channels");
  expect(count(1284, "window")).toBe("1,284 windows");
  expect(count(2, "match", "matches")).toBe("2 matches");
});

test("decimals_round_to_what_a_reader_compares", () => {
  expect(decimal(93600.00140400001)).toBe("93,600.001");
  expect(decimal(599.999994)).toBe("600");
  expect(decimal(300.03000300030004)).toBe("300.03");
  expect(decimal(256)).toBe("256");
});
