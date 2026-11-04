// The live stream section of the library rail: the address `ddalab stream --serve` printed, and a dialog that shows
// the stream's newest samples, its DDA results as they come and the latest class.
import { Dialog } from "@base-ui/react/dialog";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { colorIndex, LUTS } from "../../render/colormaps";
import controls from "../../styles/controls.module.css";
import editor from "../inspector/MetadataEditor.module.css";
import rail from "../library/LibraryRail.module.css";
import styles from "./Live.module.css";
import { connectLive, type LiveBuffer, liveAddress } from "./live";

/** Seconds of samples the view draws. */
const SECONDS = 10;

export function LivePanel() {
  const [address, setAddress] = useState("");
  const [connected, setConnected] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const connect = (event: FormEvent) => {
    event.preventDefault();
    try {
      setConnected(liveAddress(address));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className={rail.section} aria-label="Live stream">
      <h2 className={rail.heading}>Live stream</h2>
      <form className={styles.form} onSubmit={connect}>
        <input
          className={styles.field}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="ws://127.0.0.1:8765/?token=…"
          aria-label="Live stream address"
          spellCheck={false}
        />
        <button type="submit" className={controls.button} disabled={!address.trim()}>
          Connect
        </button>
      </form>
      {error ? (
        <p className={rail.error} role="alert">
          {error}
        </p>
      ) : (
        <p className={rail.hint}>
          Run <code>ddalab stream --stream NAME --serve 8765</code> on this computer and paste the address it
          prints.
        </p>
      )}
      <Dialog.Root open={connected !== null} onOpenChange={(open) => !open && setConnected(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop className={editor.backdrop} />
          <Dialog.Popup className={`${editor.popup} ${styles.popup}`}>
            {connected && <LiveView address={connected} onEnd={setError} />}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

function LiveView(props: { address: string; onEnd(reason: string): void }) {
  const [live, setLive] = useState<LiveBuffer | null>(null);
  const [ended, setEnded] = useState<string>();
  const [, redraw] = useState(0);
  const { address, onEnd } = props;
  useEffect(() => {
    let frame = 0;
    const disconnect = connectLive(
      address,
      SECONDS,
      (buffer) => {
        setLive(buffer);
        // One redraw per frame, however many messages arrive in it.
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            redraw((n) => n + 1);
          });
        }
      },
      (reason) => {
        setEnded(reason);
        onEnd(reason);
      },
    );
    return () => {
      cancelAnimationFrame(frame);
      disconnect();
    };
  }, [address, onEnd]);

  if (!live) {
    return (
      <p className={rail.hint} aria-live="polite">
        {ended ?? "Connecting…"}
      </p>
    );
  }
  const { header } = live;
  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <Dialog.Title className={editor.title}>{header.name}</Dialog.Title>
        <p className={rail.hint} aria-live="polite">
          {ended ??
            `${header.channels.length} channels at ${header.sample_rate_hz} Hz, ${(live.received / header.sample_rate_hz).toFixed(0)} s received`}
        </p>
        {live.latestClass && (
          <output className={styles.class} aria-label="Latest class">
            {live.latestClass.class} <span className={rail.hint}>at {live.latestClass.t.toFixed(1)} s</span>
          </output>
        )}
      </header>
      <Waveform live={live} />
      {Object.entries(header.variants).map(([variant, rows]) => (
        <Results key={variant} live={live} variant={variant} rows={rows} />
      ))}
      <Dialog.Close className={controls.quiet}>Disconnect</Dialog.Close>
    </div>
  );
}

const cssColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** The newest samples of every channel, one lane each, scaled by the lane's own spread. */
function Waveform({ live }: { live: LiveBuffer }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const { width, height } = sized(element);
    const lanes = live.header.channels.length;
    const lane = height / lanes;
    context.clearRect(0, 0, width, height);
    context.strokeStyle = cssColor("--ink");
    context.lineWidth = devicePixelRatio;
    const capacity = SECONDS * live.header.sample_rate_hz;
    for (let c = 0; c < lanes; c++) {
      const samples = live.channel(c);
      let sum = 0;
      for (const v of samples) sum += v;
      const mean = sum / Math.max(1, samples.length);
      let spread = 0;
      for (const v of samples) spread += (v - mean) ** 2;
      const scale = (lane * 0.4) / (Math.sqrt(spread / Math.max(1, samples.length)) * 3 || 1);
      context.beginPath();
      const start = capacity - samples.length;
      for (let i = 0; i < samples.length; i++) {
        const x = ((start + i) / capacity) * width;
        const y = lane * (c + 0.5) - (samples[i] - mean) * scale;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
  });
  return (
    <figure className={styles.figure}>
      <div className={styles.lanes}>
        <ol className={styles.labels}>
          {live.header.channels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ol>
        <canvas
          ref={canvas}
          className={styles.waveform}
          aria-label={`The last ${SECONDS} seconds of every channel`}
        />
      </div>
    </figure>
  );
}

/** A variant's newest results as a heatmap: a row per result row, a column per result, symmetric limits. */
function Results(props: { live: LiveBuffer; variant: string; rows: string[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const results = props.live.results(props.variant);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context || results.length === 0) return;
    const rows = props.rows.length;
    const columns = results.length;
    let limit = 0;
    for (const { values } of results)
      for (const v of values) if (Number.isFinite(v)) limit = Math.max(limit, Math.abs(v));
    const image = context.createImageData(columns, rows);
    const lut = LUTS.vik;
    results.forEach(({ values }, x) => {
      values.forEach((v, y) => {
        const at = 4 * (y * columns + x);
        const i = 4 * colorIndex(Number.isFinite(v) ? v : 0, -limit || -1, limit || 1);
        image.data.set(lut.subarray(i, i + 4), at);
      });
    });
    element.width = columns;
    element.height = rows;
    context.putImageData(image, 0, 0);
  });
  const latest = results.at(-1);
  return (
    <figure className={styles.figure}>
      <figcaption className={rail.heading}>
        {props.variant} <span>{latest ? `${latest.t.toFixed(1)} s` : "waiting for the first window"}</span>
      </figcaption>
      <div className={styles.lanes}>
        <ol className={styles.labels}>
          {props.rows.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ol>
        <canvas ref={canvas} className={styles.heatmap} aria-label={`${props.variant} results over time`} />
      </div>
    </figure>
  );
}

/** Sizes `canvas` to its box in device pixels. */
function sized(canvas: HTMLCanvasElement) {
  const width = Math.round(canvas.clientWidth * devicePixelRatio);
  const height = Math.round(canvas.clientHeight * devicePixelRatio);
  if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
  return { width, height };
}
