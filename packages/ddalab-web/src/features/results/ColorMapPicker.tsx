// The heatmap's color map: the color bar's ramp is the button, and the list shows each map as its own ramp. Automatic
// leaves the choice to the array (`mapOf`); a picked map holds for every result.
import { Select } from "@base-ui/react/select";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import { gradient, MAPS, type MapName } from "../../render/colormaps";
import { setColormap, useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import styles from "./Results.module.css";

const AUTO = "auto";
const KINDS = [...new Set(MAPS.map((m) => m.kind))];

export function ColorMapPicker(props: { map: MapName; auto: MapName; label: string }) {
  const picked = useStore((s) => s.colormap);
  return (
    <Select.Root
      value={picked ?? AUTO}
      items={[{ value: AUTO, label: "Automatic" }, ...MAPS.map((m) => ({ value: m.name, label: m.name }))]}
      onValueChange={(value) => setColormap(value === AUTO || value === null ? null : (value as MapName))}
    >
      <Select.Trigger
        className={styles.rampButton}
        aria-label={`Color map: ${picked ? props.map : `automatic, ${props.map}`}. ${props.label}`}
      >
        <span className={styles.ramp} style={{ background: gradient(props.map) }} />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner side="top" sideOffset={6} alignItemWithTrigger={false}>
          <Select.Popup className={controls.popup}>
            <Select.List className={controls.list}>
              <Item value={AUTO} map={props.auto} name="Automatic" note={props.auto} />
              {KINDS.map((kind) => (
                <Select.Group key={kind}>
                  <Select.GroupLabel className={styles.mapKind}>{kind}</Select.GroupLabel>
                  {MAPS.filter((m) => m.kind === kind).map((m) => (
                    <Item key={m.name} value={m.name} map={m.name} name={m.name} />
                  ))}
                </Select.Group>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function Item(props: { value: string; map: MapName; name: string; note?: string }) {
  return (
    <Select.Item value={props.value} className={`${controls.item} ${styles.mapItem}`}>
      <Select.ItemIndicator>
        <Check aria-hidden />
      </Select.ItemIndicator>
      <span className={styles.swatch} style={{ background: gradient(props.map) }} aria-hidden />
      <Select.ItemText className={styles.mapName}>{props.name}</Select.ItemText>
      {props.note && <small className={styles.mapNote}>{props.note}</small>}
    </Select.Item>
  );
}
