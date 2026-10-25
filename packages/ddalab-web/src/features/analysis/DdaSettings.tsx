// The DDA settings in the inspector: the variants the core offers (its metadata), the windowing, and the model,
// whose expert values are sent only in expert mode.
import { use, useId } from "react";
import { variants } from "../../app/analyses";
import { setDdaForm, useStore } from "../../store/store";
import styles from "./Analysis.module.css";
import { useRunRequest } from "./RunBar";
import { STANDARD } from "./validate";

type TextField = "windowLength" | "windowStep" | "delays" | "modelTerms" | "dm" | "order" | "nrTau";

export function DdaSettings({ recordingId }: { recordingId: string }) {
  const form = useStore((s) => s.ddaForm);
  const rate = useStore((s) => s.recordings[recordingId]?.info.sample_rate_hz ?? 0);
  const metadata = use(variants);
  const { errors } = useRunRequest(recordingId);
  const heading = useId();
  const field = (name: TextField, label: string, unit?: string) => (
    <Field name={name} label={label} unit={unit} value={form[name]} error={errors[name]} />
  );
  const [windowLength, windowStep] = [Number(form.windowLength), Number(form.windowStep)];
  return (
    <section aria-labelledby={heading} className={styles.settings}>
      <h3 id={heading} className={styles.heading}>
        DDA settings
      </h3>
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
          <p className={styles.fieldError}>No variants: the engine did not start.</p>
        ) : (
          errors.variants && <p className={styles.fieldError}>{errors.variants}</p>
        )}
      </fieldset>
      <fieldset className={styles.group}>
        <legend>Windowing</legend>
        {field("windowLength", "Window", "samples")}
        {field("windowStep", "Step", "samples")}
        {windowLength > 0 && windowStep > 0 && rate > 0 && (
          <p className={styles.note}>
            {`${(windowLength / rate).toFixed(2)} s window, ${(windowStep / rate).toFixed(2)} s step at ${rate} Hz`}
          </p>
        )}
      </fieldset>
      <fieldset className={styles.group}>
        <legend>Model</legend>
        <label className={styles.expert}>
          <input
            type="checkbox"
            checked={form.expert}
            onChange={(event) => setDdaForm({ expert: event.target.checked })}
          />
          Expert
        </label>
        {form.expert ? (
          <>
            {field("delays", "Delays", "samples")}
            {field("nrTau", "Delays used")}
            {field("modelTerms", "Terms")}
            {field("dm", "Dimension")}
            {field("order", "Order")}
          </>
        ) : (
          // Standard mode sends these whatever the expert fields hold.
          <dl className={styles.facts} aria-label="Standard model">
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
      </fieldset>
    </section>
  );
}

function Field(props: { name: TextField; label: string; unit?: string; value: string; error?: string }) {
  const id = useId();
  return (
    <div className={styles.field}>
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
        <p id={`${id}-error`} className={styles.fieldError}>
          {props.error}
        </p>
      )}
    </div>
  );
}
