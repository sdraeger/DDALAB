import { expect, test } from "vitest";
import { buildFigureSvg } from "./figureExport";

test("build_figure_svg_produces_valid_labeled_svg_with_markers_and_colorbar", () => {
  const svg = buildFigureSvg({
    title: "sub-01_ieeg.vhdr — Single Timeseries (ST)",
    subtitle: "WL 200, WS 100, delays [7, 10] · DDALAB 2.9.0",
    rowLabels: ["LA1", "LA2"],
    values: new Float32Array([0.1, -0.5, 0.4, 0.8, -0.2, 0.3]),
    windows: 3,
    rows: 2,
    t0: 0,
    t1: 10,
    map: "vik",
    lo: -1,
    hi: 1,
    valueName: "Q",
    annotations: [{ onset_s: 4.5, label: "seizure onset" }],
  });
  expect(svg).toContain("<svg ");
  expect(svg).toContain("sub-01_ieeg.vhdr");
  expect(svg).toContain("LA1");
  expect(svg).toContain("LA2");
  expect(svg).toContain("seizure onset");
  expect(svg).toContain("linearGradient");
  expect(svg).toContain("</svg>");
});
