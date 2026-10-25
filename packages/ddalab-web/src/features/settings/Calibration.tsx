// Display calibration: a bar meant to be 50 mm long, which the user matches with a ruler. The setting maps CSS
// millimetres to physical ones; sensitivity (µV/mm) and timebase (mm/s) then hold on this screen.
import { setCalibration, useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import styles from "./Calibration.module.css";

const BAR_MM = 50;

export default function Calibration() {
  const mmPerCssMm = useStore((s) => s.view.mmPerCssMm);
  // The bar is 50 physical mm when the setting is right: 50 / mmPerCssMm CSS mm.
  const barMm = BAR_MM / mmPerCssMm;
  return (
    <div className={styles.calibration}>
      <h2 className={styles.title}>Display calibration</h2>
      <p className={styles.text}>
        Hold a ruler to the bar and adjust until it measures {BAR_MM} mm. Sensitivity and timebase are then
        true to the millimetre on this screen.
      </p>
      <div className={styles.bar} style={{ width: `${barMm}mm` }} aria-hidden />
      <label className={styles.field}>
        <span className={controls.label}>Bar length on screen</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.005}
          value={1 / mmPerCssMm}
          aria-valuetext={`${(BAR_MM / mmPerCssMm).toFixed(1)} CSS mm`}
          onChange={(event) => setCalibration(1 / Number(event.target.value))}
        />
      </label>
      <div className={styles.actions}>
        <span className={controls.label}>{`${mmPerCssMm.toFixed(3)} mm per CSS mm`}</span>
        <button type="button" className={controls.quiet} onClick={() => setCalibration(1)}>
          Reset
        </button>
      </div>
    </div>
  );
}
