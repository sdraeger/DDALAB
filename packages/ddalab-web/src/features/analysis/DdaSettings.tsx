// The DDA settings in the inspector: curated presets, the variants the core offers (its metadata),
// windowing with optional samples <-> physical-time editing, and the model (whose expert values are sent only in expert mode).

import { use, useEffect, useId, useState } from "react";
import { variants } from "../../app/analyses";
import { SelectField } from "../../app/SelectField";
import { DDA_PRESETS, presetToForm, STANDARD } from "../../core/ddaForm";
import { gpuAvailable } from "../../core/webgpu";
import { decimal } from "../../core/words";
import { setDdaForm, setGpu, useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import styles from "./Analysis.module.css";
import { useRunRequest } from "./RunBar";

type TextField = "windowLength" | "windowStep" | "delays" | "modelTerms" | "dm" | "order" | "nrTau";
type UnitMode = "samples" | "time";

const formatSeconds = (samples: number, rate: number) =>
  samples > 0 && rate > 0 ? String(Number((samples / rate).toFixed(4))) : "";

const formatDelaysMs = (text: string, rate: number) => {
  if (rate <= 0) return "";
  const nums = text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);
  return nums.map((d) => String(Number(((d * 1000) / rate).toFixed(2)))).join(", ");
};

const PRESET_ITEMS = [
  { value: "", label: "Custom / default" },
  ...DDA_PRESETS.map((p) => ({ value: p.id, label: p.name })),
];

export function DdaSettings({ recordingId }: { recordingId: string }) {
  const form = useStore((s) => s.ddaForm);
  const rate = useStore((s) => s.recordings[recordingId]?.info.sample_rate_hz ?? 0);
  const metadata = use(variants);
  const { errors } = useRunRequest(recordingId);
  const heading = useId();
  const [selectedPreset, setSelectedPreset] = useState("");
  const [unitMode, setUnitMode] = useState<UnitMode>("samples");
  const [timeDraft, setTimeDraft] = useState({ wlS: "", wsS: "", delaysMs: "" });

  const activePreset = DDA_PRESETS.find((p) => p.id === selectedPreset);
  const effectiveMode: UnitMode = rate > 0 ? unitMode : "samples";

  const switchUnits = (next: UnitMode) => {
    if (next === effectiveMode) return;
    if (next === "time" && rate > 0) {
      setTimeDraft({
        wlS: formatSeconds(Number(form.windowLength), rate),
        wsS: formatSeconds(Number(form.windowStep), rate),
        delaysMs: formatDelaysMs(form.delays, rate),
      });
    }
    setUnitMode(next);
  };

  const applyPreset = (id: string) => {
    setSelectedPreset(id);
    const preset = DDA_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const next = presetToForm(preset, rate);
    setDdaForm(next);
    if (effectiveMode === "time" && rate > 0) {
      setTimeDraft({
        wlS: formatSeconds(Number(next.windowLength), rate),
        wsS: formatSeconds(Number(next.windowStep), rate),
        delaysMs: formatDelaysMs(next.delays, rate),
      });
    }
  };

  const field = (name: TextField, label: string, unit?: string) => (
    <Field name={name} label={label} unit={unit} value={form[name]} error={errors[name]} />
  );
  const [windowLength, windowStep] = [Number(form.windowLength), Number(form.windowStep)];
  const activeDelays = form.expert
    ? form.delays
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= 0)
    : STANDARD.delays;

  return (
    <section aria-labelledby={heading} className={styles.settings}>
      {/* The batch panel's "Change them in the inspector" brings the keyboard here. */}
      <div className={styles.headingRow}>
        <h3 id={heading} className={styles.heading} tabIndex={-1} data-dda-settings>
          DDA settings
        </h3>
        {rate > 0 && (
          <fieldset className={styles.unitToggle} aria-label="Parameter units">
            <button
              type="button"
              className={controls.quiet}
              aria-pressed={effectiveMode === "samples"}
              onClick={() => switchUnits("samples")}
            >
              samples
            </button>
            <button
              type="button"
              className={controls.quiet}
              aria-pressed={effectiveMode === "time"}
              onClick={() => switchUnits("time")}
            >
              s / ms
            </button>
          </fieldset>
        )}
      </div>
      <SelectField label="Preset" value={selectedPreset} items={PRESET_ITEMS} onChange={applyPreset} />
      {activePreset && (
        <p className={styles.note} data-appear>
          {activePreset.citation}
        </p>
      )}
      <fieldset className={styles.group}>
        <legend>Variants</legend>
        <div className={styles.variants}>
          {metadata.map((variant) => (
            <label key={variant.abbreviation} title={variant.name}>
              <input
                type="checkbox"
                checked={form.variants.includes(variant.abbreviation)}
                onChange={(event) =>
                  setDdaForm({
                    variants: event.target.checked
                      ? [...form.variants, variant.abbreviation]
                      : form.variants.filter((v) => v !== variant.abbreviation),
                  })
                }
              />
              <span className={styles.acronym}>{variant.abbreviation}</span>
            </label>
          ))}
        </div>
        {metadata.length === 0 ? (
          <p className={styles.fieldError} data-appear>
            No variants: the engine did not start.
          </p>
        ) : (
          errors.variants && (
            <p className={styles.fieldError} data-appear>
              {errors.variants}
            </p>
          )
        )}
      </fieldset>
      <fieldset className={styles.group}>
        <legend>Windowing</legend>
        {effectiveMode === "time" ? (
          <>
            <PhysicalField
              label="Window"
              unit="s"
              value={timeDraft.wlS}
              error={errors.windowLength}
              onChange={(text) => {
                setTimeDraft((d) => ({ ...d, wlS: text }));
                const sec = Number(text.trim());
                if (Number.isFinite(sec) && sec > 0) {
                  setDdaForm({ windowLength: String(Math.max(1, Math.round(sec * rate))) });
                } else {
                  setDdaForm({ windowLength: "" });
                }
              }}
            />
            <PhysicalField
              label="Step"
              unit="s"
              value={timeDraft.wsS}
              error={errors.windowStep}
              onChange={(text) => {
                setTimeDraft((d) => ({ ...d, wsS: text }));
                const sec = Number(text.trim());
                if (Number.isFinite(sec) && sec > 0) {
                  setDdaForm({ windowStep: String(Math.max(1, Math.round(sec * rate))) });
                } else {
                  setDdaForm({ windowStep: "" });
                }
              }}
            />
          </>
        ) : (
          <>
            {field("windowLength", "Window", "samples")}
            {field("windowStep", "Step", "samples")}
          </>
        )}
        {windowLength > 0 && windowStep > 0 && rate > 0 && (
          <p className={styles.note} data-appear>
            {effectiveMode === "time"
              ? `${windowLength} samples window, ${windowStep} samples step at ${decimal(rate)} Hz`
              : `${(windowLength / rate).toFixed(2)} s window, ${(windowStep / rate).toFixed(2)} s step at ${decimal(rate)} Hz`}
          </p>
        )}
      </fieldset>
      <fieldset className={styles.group}>
        <legend>Model</legend>
        <label className={styles.expert}>
          <input
            type="checkbox"
            checked={form.expert}
            onChange={(event) => {
              const checked = event.target.checked;
              setDdaForm({ expert: checked });
              if (checked && effectiveMode === "time" && rate > 0) {
                setTimeDraft((d) => ({ ...d, delaysMs: formatDelaysMs(form.delays, rate) }));
              }
            }}
          />
          Expert
        </label>
        {form.expert ? (
          <>
            {effectiveMode === "time" ? (
              <PhysicalField
                label="Delays"
                unit="ms"
                textMode
                value={timeDraft.delaysMs}
                error={errors.delays}
                onChange={(text) => {
                  setTimeDraft((d) => ({ ...d, delaysMs: text }));
                  const parts = text.split(/[\s,]+/).filter(Boolean);
                  const nums = parts.map(Number);
                  if (parts.length > 0 && nums.every((ms) => Number.isFinite(ms) && ms >= 0)) {
                    const samples = nums.map((ms) =>
                      ms === 0 ? 0 : Math.max(1, Math.round((ms / 1000) * rate)),
                    );
                    setDdaForm({ delays: samples.join(", ") });
                  } else {
                    setDdaForm({ delays: "" });
                  }
                }}
              />
            ) : (
              field("delays", "Delays", "samples")
            )}
            {field("nrTau", "Delays used")}
            {field("modelTerms", "Terms")}
            {field("dm", "Dimension")}
            {field("order", "Order")}
          </>
        ) : (
          // Standard mode sends these whatever the expert fields hold.
          <dl className={styles.facts} aria-label="Standard model" data-appear>
            <div>
              <dt>Delays</dt>
              <dd>{STANDARD.delays.join(", ")}</dd>
            </div>
            <div>
              <dt>Terms</dt>
              <dd>{STANDARD.modelTerms.join(" ")}</dd>
            </div>
            <div>
              <dt>Dimension</dt>
              <dd>{STANDARD.dm}</dd>
            </div>
            <div>
              <dt>Order</dt>
              <dd>{STANDARD.order}</dd>
            </div>
            <div>
              <dt>Delays used</dt>
              <dd>{STANDARD.nrTau}</dd>
            </div>
          </dl>
        )}
        {rate > 0 && activeDelays.length > 0 && (
          <p className={styles.note}>
            {effectiveMode === "time"
              ? `Delays: ${activeDelays.join(", ")} samples at ${decimal(rate)} Hz`
              : `Delays: ${activeDelays.map((d) => `${((d * 1000) / rate).toFixed(1)} ms`).join(", ")} at ${decimal(rate)} Hz`}
          </p>
        )}
      </fieldset>
      <Gpu />
    </section>
  );
}

/** The GPU choice, shown where the browser offers WebGPU. */
function Gpu() {
  const gpu = useStore((s) => s.gpu);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    void gpuAvailable().then(setAvailable);
  }, []);
  if (!available) return null;
  return (
    <fieldset className={styles.group} data-appear>
      <legend>Compute</legend>
      <label className={styles.expert}>
        <input type="checkbox" checked={gpu} onChange={(event) => setGpu(event.target.checked)} />
        Use GPU (WebGPU)
      </label>
      <p className={styles.note}>
        Sums each window on the GPU in exact 47-bit integer arithmetic and solves it in double precision for
        ST, CT, DE, CD, and SY: values agree with the CPU to about 1e-9, and the result records the GPU.
      </p>
    </fieldset>
  );
}

function Field(props: { name: TextField; label: string; unit?: string; value: string; error?: string }) {
  const id = useId();
  return (
    <div className={styles.field} data-appear>
      <label htmlFor={id}>{props.label}</label>
      <span className={styles.unitInput}>
        <input
          id={id}
          inputMode={props.name === "delays" || props.name === "modelTerms" ? "text" : "numeric"}
          value={props.value}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={props.error ? `${id}-error` : undefined}
          onChange={(event) => setDdaForm({ [props.name]: event.target.value })}
        />
        {props.unit && <span aria-hidden>{props.unit}</span>}
      </span>
      {props.error && (
        <p id={`${id}-error`} className={styles.fieldError} data-appear>
          {props.error}
        </p>
      )}
    </div>
  );
}

function PhysicalField(props: {
  label: string;
  unit: string;
  value: string;
  error?: string;
  textMode?: boolean;
  onChange(value: string): void;
}) {
  const id = useId();
  return (
    <div className={styles.field} data-appear>
      <label htmlFor={id}>{props.label}</label>
      <span className={styles.unitInput}>
        <input
          id={id}
          inputMode={props.textMode ? "text" : "decimal"}
          value={props.value}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={props.error ? `${id}-error` : undefined}
          onChange={(event) => props.onChange(event.target.value)}
        />
        <span aria-hidden>{props.unit}</span>
      </span>
      {props.error && (
        <p id={`${id}-error`} className={styles.fieldError} data-appear>
          {props.error}
        </p>
      )}
    </div>
  );
}
