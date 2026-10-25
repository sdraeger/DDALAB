// Display units of the plots: what a raw sample of each display channel draws as.
import type { OpenRecording } from "../store/store";

/**
 * Per display channel, display units per raw unit and the offset: µV for voltage channels (SI volts).
 * shortcut: other units draw in their SI unit at the µV/mm sensitivity; give them a scale of their own when
 * recordings mix in non-voltage channels that matter.
 */
export function paramsOf(recording: OpenRecording): Float32Array {
  const params = new Float32Array(2 * recording.analysis_channels.length);
  recording.analysis_channels.forEach((index, c) => {
    const { unit, gain, offset } = recording.info.channels[index];
    const scale = unit === "V" ? 1e6 : 1;
    params[2 * c] = gain * scale;
    params[2 * c + 1] = offset * scale;
  });
  return params;
}
