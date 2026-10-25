// The `ddalab run` command that writes the bundle of a request natively, for a shell in the folder of the recording.
import type { DDARequest } from "./types";

/** A word as POSIX sh reads it: plain when it is only safe characters, else in single quotes. */
const quote = (word: string) => (/^[\w./:=@%+,-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`);

/** `name` and its values, quoted; nothing when there are none. */
const flag = (name: string, values: (number | string | null | undefined)[] | null | undefined) => {
  const given = (values ?? []).filter((v) => v !== null && v !== undefined);
  return given.length > 0 ? [name, ...given.map((v) => quote(String(v)))] : [];
};

/** `--name=value`: a value that starts with "-" stays a value. */
const named = (name: string, value: string) => [`${name}=${quote(value)}`];

/**
 * The command for `request` on the recording `fileName`. What the request leaves out (a text recording's rate, the
 * model) the CLI derives as the browser's core does. A request with per-variant configurations, which the browser
 * never makes, needs `--variant-configs` added by hand.
 */
export function cliCommand(request: DDARequest, fileName: string): string {
  const { window_parameters: window, model_parameters: model, preprocessing_options: filters } = request;
  const pairs = (list: [number, number][] | undefined) => list?.map(([a, b]) => `${a},${b}`);
  const words = [
    ...named("--file", fileName),
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
    ...flag("--highpass", [filters.highpass]),
    ...flag("--lowpass", [filters.lowpass]),
    ...flag("--sr", [request.sampling_rate]),
    ...flag("--start-sample", [request.time_range.start]),
    ...flag("--end-sample", [request.time_range.end]),
    ...named("--bundle", `${fileName.replace(/\.[^.]*$/, "")}.dda`),
  ];
  return ["ddalab", "run", ...words].join(" ");
}
