import { useStore } from "../store/store";
import { closeRecording } from "./recordings";

/** A plain listing of the active recording; the designed inspector comes with the workspace shell. */
export function Inspector() {
  const id = useStore((s) => s.activeRecordingId);
  const recording = useStore((s) => (s.activeRecordingId ? s.recordings[s.activeRecordingId] : undefined));
  if (!id || !recording) {
    return (
      <section aria-label="Inspector">
        <p>Open a recording to see its channels.</p>
      </section>
    );
  }
  const { info, scan, analysis_channels } = recording;
  // Signals at another rate than the display channels are not analyzed or displayed.
  const analyzed = new Set(analysis_channels);
  const others = info.channels.flatMap((channel, i) =>
    channel.kind === "Signal" && !analyzed.has(i) ? [{ channel, i }] : [],
  );
  const percent = scan.totalRows === 0 ? 100 : Math.floor((100 * scan.scannedRows) / scan.totalRows);
  return (
    <section aria-label="Inspector">
      <h2>{info.input_files[0]}</h2>
      <dl>
        <dt>Format</dt>
        <dd>{info.format}</dd>
        <dt>Duration</dt>
        <dd>{info.duration_s} s</dd>
        <dt>Sample rate</dt>
        <dd>{info.sample_rate_hz} Hz</dd>
      </dl>
      {scan.notice ? (
        <p>{scan.notice}</p>
      ) : (
        <p>
          Overview {percent}% <progress aria-label="Overview" max={100} value={percent} />
        </p>
      )}
      {scan.error && <p role="alert">{scan.error}</p>}
      <ul aria-label="Channels">
        {analysis_channels.map((index) => (
          <li key={index}>{info.channels[index].label}</li>
        ))}
      </ul>
      {others.length > 0 && (
        <>
          <p>Not analyzed or displayed (another sample rate):</p>
          <ul aria-label="Not analyzed">
            {others.map(({ channel, i }) => (
              <li key={i}>
                {channel.label} ({channel.sample_rate_hz} Hz)
              </li>
            ))}
          </ul>
        </>
      )}
      {info.warnings.length > 0 && (
        <ul aria-label="Warnings">
          {info.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => closeRecording(id)}>
        Close recording
      </button>
    </section>
  );
}
