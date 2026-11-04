import { expect, test } from "vitest";
import { electrodeGroups, shownLabel } from "./groups";

test("groups_follow_leading_letters", () => {
  const { groups, groupOf } = electrodeGroups(["ATT1", "ATT2", "PST1", "G12", "ATT3", "12", "G1"]);
  expect(groups.map((g) => [g.name, g.members])).toEqual([
    ["ATT", [0, 1, 4]],
    ["PST", [2]],
    ["G", [3, 6]],
    ["Other", [5]],
  ]);
  expect(Array.from(groupOf)).toEqual([0, 0, 1, 2, 0, 3, 2]);
  // The first three groups take the contract's tints, in order.
  expect(groups.slice(0, 3).map((g) => g.tint)).toEqual([
    "var(--group-1)",
    "var(--group-2)",
    "var(--group-3)",
  ]);
});

test("groups_take_letters_of_any_script", () => {
  const { groups } = electrodeGroups(["Kanał 3", "Kanał 4", "Ödem1"]);
  expect(groups.map((g) => g.name)).toEqual(["Kanał", "Ödem"]);
});

test("an_empty_label_shows_its_position", () => {
  expect(shownLabel("", 5)).toBe("Ch 6");
  expect(shownLabel("  ", 0)).toBe("Ch 1");
  expect(shownLabel("Cz", 5)).toBe("Cz");
});
