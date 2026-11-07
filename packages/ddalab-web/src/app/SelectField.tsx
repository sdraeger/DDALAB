// The house select: a label, a trigger showing the chosen value, and a popup list that checks it.
import { Select } from "@base-ui/react/select";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import type { ReactNode } from "react";
import controls from "../styles/controls.module.css";

/**
 * A labeled select of `items`. The trigger shows the value through `shown`, by default its item's label; the value
 * may lie between the items (the timebase). A `disabled` item shows but cannot be picked.
 */
export function SelectField<V extends string | number>(props: {
  label: string;
  value: V;
  items: { value: V; label: string; disabled?: boolean }[];
  shown?: (value: V) => ReactNode;
  onChange(value: V): void;
}) {
  const { items, shown } = props;
  return (
    <Select.Root
      value={props.value}
      items={items}
      onValueChange={(value) => value !== null && props.onChange(value as V)}
    >
      <div className={controls.field}>
        <Select.Label className={controls.label}>{props.label}</Select.Label>
        <Select.Trigger className={controls.trigger}>
          {shown ? <Select.Value>{(value: V) => shown(value)}</Select.Value> : <Select.Value />}
          <Select.Icon>
            <ChevronDown aria-hidden />
          </Select.Icon>
        </Select.Trigger>
      </div>
      <Select.Portal>
        <Select.Positioner sideOffset={4} alignItemWithTrigger={false}>
          <Select.Popup className={controls.popup}>
            <Select.List className={controls.list}>
              {items.map((item) => (
                <Select.Item
                  key={item.value}
                  value={item.value}
                  disabled={item.disabled}
                  className={controls.item}
                >
                  <Select.ItemIndicator>
                    <Check aria-hidden />
                  </Select.ItemIndicator>
                  <Select.ItemText className={controls.itemText}>{item.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
