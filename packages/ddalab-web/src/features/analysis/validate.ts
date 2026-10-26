// The DDA settings form as a request. Only what the form itself decides is checked here: its fields, the standard
// mode's fixed model and the run interval in samples. The core checks the request (channel indices, variants) when it
// plans the run, and its message is shown as it is.
import type { DDARequest, RecordingInfo, VariantInfo } from "../../core/types";

/** What the form holds, as typed. Expert values stay here in standard mode, which does not send them. */
export interface DdaForm {
  expert: boolean;
  /** Abbreviations of the chosen variants. */
  variants: string[];
  windowLength: string;
  windowStep: string;
  delays: string;
  modelTerms: string;
  dm: string;
  order: string;
  nrTau: string;
}

export interface DdaDraft extends Omit<DdaForm, "variants"> {
  /** The chosen variants' metadata, from the core (`Engine.version`). */
  variants: VariantInfo[];
  /** Indices into the recording's analysis channels. */
  channels: number[];
  /** The run interval in seconds: the selection, or the view interval when nothing is selected. */
  startS: number;
  endS: number;
}

/** What standard mode always sends (the CLI's defaults). */
export const STANDARD = { delays: [7, 10], modelTerms: [1, 2, 10], dm: 4, order: 4, nrTau: 2 };

/** The window defaults are the CLI's; ST is its default variant. */
export const DEFAULT_FORM: DdaForm = {
  expert: false,
  variants: ["ST"],
  windowLength: "200",
  windowStep: "100",
  delays: STANDARD.delays.join(", "),
  modelTerms: STANDARD.modelTerms.join(" "),
  dm: String(STANDARD.dm),
  order: String(STANDARD.order),
  nrTau: String(STANDARD.nrTau),
};

/** Positions in the "ST CT CD RESERVED DE SY" mask (`SELECT_MASK_SIZE` in dda-rs `variants.rs`). */
const SELECT_MASK_SIZE = 6;

/** Whole numbers from at least `min`, separated by commas or spaces; `undefined` when one is not. */
function wholeNumbers(text: string, min: number): number[] | undefined {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  const ok = parts.length > 0 && parts.every((p) => /^\d+$/.test(p) && Number(p) >= min);
  return ok ? parts.map(Number) : undefined;
}

export function validateRequest(
  draft: DdaDraft,
  info: RecordingInfo,
): { request?: DDARequest; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const positive = (field: "windowLength" | "windowStep" | "dm" | "order" | "nrTau", name: string) => {
    const text = draft[field].trim();
    if (/^\d+$/.test(text) && Number(text) >= 1) return Number(text);
    errors[field] = `${name} must be a whole number above 0`;
    return 0;
  };

  if (draft.variants.length === 0) errors.variants = "Choose at least one variant";
  const windowLength = positive("windowLength", "The window");
  const windowStep = positive("windowStep", "The step");

  let model = STANDARD;
  if (draft.expert) {
    const nrTau = positive("nrTau", "The delays used");
    const delays = wholeNumbers(draft.delays, 0);
    if (!delays) errors.delays = "Delays must be non-negative whole numbers";
    else if (delays.length < nrTau)
      errors.delays = `Give at least ${nrTau} delays, as many as the delays used`;
    const modelTerms = wholeNumbers(draft.modelTerms, 1);
    if (!modelTerms) errors.modelTerms = "Terms must be whole numbers above 0";
    model = {
      delays: delays ?? [],
      modelTerms: modelTerms ?? [],
      dm: positive("dm", "The dimension"),
      order: positive("order", "The order"),
      nrTau,
    };
  }

  const { channels } = draft;
  const pairwise = draft.variants.filter((v) => v.channel_format !== "individual");
  if (channels.length === 0) errors.channels = "Choose at least one channel";
  else if (pairwise.length > 0 && channels.length < 2) {
    errors.channels = `${pairwise.map((v) => v.abbreviation).join(" and ")} need at least two channels`;
  }

  // Seconds become samples as the CLI's `--start` and `--end` do; the end is inclusive.
  const sample = (s: number) => Math.max(0, Math.floor(s * info.sample_rate_hz + 1e-6));
  const start = sample(draft.startS);
  const end = Math.min(sample(draft.endS), info.sample_count - 1);
  if (!(end > start)) errors.range = "The interval must end after it starts, within the recording";

  if (Object.keys(errors).length > 0) return { errors };
  const mask = Array.from({ length: SELECT_MASK_SIZE }, (_, i) =>
    draft.variants.some((v) => v.position === i) ? 1 : 0,
  );
  const formats = new Set(pairwise.map((v) => v.channel_format));
  const pairs = (directed: boolean) =>
    channels.flatMap((i) =>
      channels.filter((j) => (directed ? j !== i : j > i)).map((j): [number, number] => [i, j]),
    );
  return {
    errors,
    request: {
      file_path: info.input_files[0],
      channels,
      time_range: { start, end },
      preprocessing_options: { highpass: null, lowpass: null },
      algorithm_selection: {
        enabled_variants: draft.variants.map((v) => v.abbreviation),
        select_mask: mask.join(" "),
      },
      window_parameters: { window_length: windowLength, window_step: windowStep },
      delay_parameters: { delays: model.delays },
      ...(formats.has("pairs") && { ct_channel_pairs: pairs(false) }),
      ...(formats.has("directed_pairs") && { cd_channel_pairs: pairs(true) }),
      model_parameters: { dm: model.dm, order: model.order, nr_tau: model.nrTau },
      model_terms: model.modelTerms,
    },
  };
}
