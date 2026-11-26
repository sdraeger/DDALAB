// The `ddalab run` command that writes the bundle of a request natively, for a shell in the folder of the recording.
import type { DDARequest, Reference } from "./types";

/** A word as POSIX sh reads it: plain when it is only safe characters, else in single quotes. */
const quote = (word: string) => (/^[\w./:=@%+,-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`);

/** `name` and its values, quoted; nothing when there are none. */
const flag = (name: string, values: (number | string | null | undefined)[] | null | undefined) => {
  const given = (values ?? []).filter((v) => v !== null && v !== undefined);
  return given.length > 0 ? [name, ...given.map((v) => quote(String(v)))] : [];
};

/** `--name=value`: a value that starts with "-" stays a value. */
const named = (name: string, value: string) => [`${name}=${quote(value)}`];

/** `--reference` and `--electrodes` for `reference`; a TSV goes by the name of the file it came from. */
const referenceWords = (reference: Reference | undefined) => {
  if (!reference) return [];
  if (reference.kind === "custom") return named("--reference", reference.name);
  const electrodes =
    reference.kind === "laplacian" && reference.name ? named("--electrodes", reference.name) : [];
  return ["--reference", reference.kind, ...electrodes];
};

/**
 * The command for `request` on the recording `fileName`, its channels derived with `reference`. What the request leaves out (a text recording's rate, the
 * model) the CLI derives as the browser's core does. A request with per-variant configurations, which the browser
 * never makes, needs `--variant-configs` added by hand.
 */
export function cliCommand(request: DDARequest, fileName: string, reference?: Reference): string {
  const { window_parameters: window, model_parameters: model } = request;
  const pairs = (list: [number, number][] | undefined) => list?.map(([a, b]) => `${a},${b}`);
  const words = [
    ...named("--file", fileName),
    ...referenceWords(reference),
    ...flag("--channels", request.channels),
    ...flag("--variants", request.algorithm_selection.enabled_variants),
    ...flag("--ct-pairs", pairs(request.ct_channel_pairs)),
    ...flag("--cd-pairs", pairs(request.cd_channel_pairs)),
    ...flag("--wl", [window.window_length]),
    ...flag("--ws", [window.window_step]),
    ...flag("--ct-wl", [window.ct_window_length]),
    ...flag("--ct-ws", [window.ct_window_step]),
    ...flag("--delays", request.delay_parameters.delays),
    ...flag("--model", request.model_terms),
    ...flag("--dm", [model?.dm]),
    ...flag("--order", [model?.order]),
    ...flag("--nr-tau", [model?.nr_tau]),
    ...flag("--sr", [request.sampling_rate]),
    ...flag("--start-sample", [request.time_range.start]),
    ...flag("--end-sample", [request.time_range.end]),
    ...named("--bundle", `${fileName.replace(/\.[^.]*$/, "")}.dda`),
  ];
  return ["ddalab", "run", ...words].join(" ");
}

/** Python string literal for `value`. */
const pyStr = (value: string) => JSON.stringify(value);

/**
 * Self-contained Python snippet reproducing `request` via `ddalab.run(...)` (`pip install ddalab`).
 * `startS` and `endS`, when provided from the result's reproduction block, emit exact physical-time bounds.
 */
export function pythonSnippet(
  request: DDARequest,
  fileName: string,
  reference?: Reference,
  rangeS?: { startS: number; endS: number },
): string {
  const { window_parameters: window, model_parameters: model } = request;
  const lines: string[] = [`    ${pyStr(fileName)},`];
  const add = (key: string, value: string) => lines.push(`    ${key}=${value},`);

  add("variants", `[${request.algorithm_selection.enabled_variants.map(pyStr).join(", ")}]`);
  if (request.channels && request.channels.length > 0) {
    add("channels", `[${request.channels.join(", ")}]`);
  }
  add("wl", String(window.window_length));
  add("ws", String(window.window_step));
  if (request.delay_parameters.delays.length > 0) {
    add("delays", `[${request.delay_parameters.delays.join(", ")}]`);
  }
  if (request.model_terms && request.model_terms.length > 0) {
    add("model", `[${request.model_terms.join(", ")}]`);
  }
  if (model) {
    add("dm", String(model.dm));
    add("order", String(model.order));
    add("nr_tau", String(model.nr_tau));
  }
  if (request.ct_channel_pairs && request.ct_channel_pairs.length > 0) {
    add("ct_pairs", `[${request.ct_channel_pairs.map(([a, b]) => `(${a}, ${b})`).join(", ")}]`);
  }
  if (request.cd_channel_pairs && request.cd_channel_pairs.length > 0) {
    add("cd_pairs", `[${request.cd_channel_pairs.map(([a, b]) => `(${a}, ${b})`).join(", ")}]`);
  }
  if (request.sampling_rate) {
    add("sfreq", String(request.sampling_rate));
  }
  if (rangeS) {
    add("start", String(Number(rangeS.startS.toFixed(6))));
    add("end", String(Number(rangeS.endS.toFixed(6))));
  }
  if (reference) {
    if (reference.kind === "custom") {
      add("reference", pyStr(reference.name));
    } else {
      add("reference", pyStr(reference.kind));
      if (reference.kind === "laplacian" && reference.name) {
        add("electrodes", pyStr(reference.name));
      }
    }
  }
  return `import ddalab\n\nresult = ddalab.run(\n${lines.join("\n")}\n)`;
}
