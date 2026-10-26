// A history row's time: a record whose time no Date holds (a project from elsewhere, stored before times were
// checked) reads as unknown instead of failing the whole history.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Time } from "./Time";

test("a_time_no_date_holds_reads_as_unknown", () => {
  expect(renderToStaticMarkup(createElement(Time, { at: 1e300 }))).toBe("<span>unknown time</span>");
  expect(renderToStaticMarkup(createElement(Time, { at: 0 }))).toMatch(
    /^<time dateTime="1970-01-01T00:00:00.000Z">/,
  );
});
