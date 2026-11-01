// The variants of a result as tabs (the arrow keys move between them), and for a variant that keeps a fit error per
// window, the choice between its values and that. The tab list belongs to the Tabs.Root of ResultPanel.
import { Tabs } from "@base-ui/react/tabs";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type { VariantDocument } from "../../core/types";
import type { ResultTile } from "../../render/resultPyramid";
import styles from "./Results.module.css";

/** What a variant's values are (dda-rs engine.rs): a name for the toggle, the color bar and the readout, and how. */
const VALUES: Record<string, [name: string, definition: string]> = {
  ST: [
    "a₁ coefficient",
    "The coefficient a₁ of the delay model's first term, fit to each window of the channel",
  ],
  CT: [
    "a₁ coefficient",
    "The coefficient a₁ of the delay model's first term, fit to each window of the channels together",
  ],
  CD: [
    "RMSE reduction",
    "For a row A <- B: the RMSE of A's own model less the RMSE of A's model with B's terms added",
  ],
  DE: [
    "|ST/CT RMSE − 1|",
    "The mean RMSE of the channels' own models over the RMSE of their joint model, less one",
  ],
  // shortcut: a legacy select mask (SY mode 2) stores each direction's RMSE instead; name it if such results appear.
  SY: [
    "RMSE asymmetry",
    "For a row A <-> B: the reverse model's RMSE over the forward's, less the forward's over the reverse's",
  ],
};
const FIT_ERROR: [string, string] = [
  "Fit RMSE",
  "The root-mean-square error of the delay model fit to each window",
];

/** The name and definition of the values of `array` in `variant`. */
export const valueInfo = (variant: string, array: ResultTile["array"]): [string, string] =>
  array === "fit_error"
    ? FIT_ERROR
    : (VALUES[variant] ?? [`${variant} value`, `The ${variant} value of each window`]);

export function VariantTabs(props: {
  variants: VariantDocument[];
  variant: string;
  hasFitError: boolean;
  array: ResultTile["array"];
  onArray(array: ResultTile["array"]): void;
}) {
  const toggle = (array: ResultTile["array"]) => {
    const [name, definition] = valueInfo(props.variant, array);
    return (
      <Toggle value={array} className={styles.toggle} title={definition}>
        {name}
      </Toggle>
    );
  };
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
          {toggle("q")}
          {toggle("fit_error")}
        </ToggleGroup>
      )}
    </>
  );
}
