// The variants of a result as tabs (the arrow keys move between them), and for a variant that keeps a fit error per
// window, the choice between its Q values and that. The tab list belongs to the Tabs.Root of ResultPanel.
import { Tabs } from "@base-ui/react/tabs";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type { VariantDocument } from "../../core/types";
import type { ResultTile } from "../../render/resultPyramid";
import styles from "./Results.module.css";

export function VariantTabs(props: {
  variants: VariantDocument[];
  hasFitError: boolean;
  array: ResultTile["array"];
  onArray(array: ResultTile["array"]): void;
}) {
  return (
    <>
      <Tabs.List className={styles.tabs} activateOnFocus aria-label="Variants" data-own-keys>
        {props.variants.map((variant) => (
          <Tabs.Tab key={variant.id} value={variant.id} className={styles.tab} title={variant.label}>
            {variant.id}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {props.hasFitError && (
        <ToggleGroup
          value={[props.array]}
          onValueChange={(value) => value[0] && props.onArray(value[0] as ResultTile["array"])}
          className={styles.toggles}
          aria-label="Values"
          data-own-keys
        >
          <Toggle value="q" className={styles.toggle}>
            Q
          </Toggle>
          <Toggle value="fit_error" className={styles.toggle}>
            Fit error
          </Toggle>
        </ToggleGroup>
      )}
    </>
  );
}
