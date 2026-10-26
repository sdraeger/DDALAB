// About DDALAB, from the command bar: its authors, the app's version, the engine that runs the analyses, the keyboard
// shortcuts (also on their own, from Help > Keyboard shortcuts), and, under its own heading, the citation and license
// notice the heatmap's color maps come with (render/colormaps.ts).
import { Popover } from "@base-ui/react/popover";
import { use } from "react";
import { version } from "../../../package.json";
import { engineVersion } from "../../app/analyses";
import { Logo } from "../../app/Logo";
import { LINUX_NOTE, MENU_KEYS, TAB_KEYS } from "../tabs/keys";
import styles from "./About.module.css";

const engineFacts = engineVersion.then(
  (v) => ({ version: v.engine_version, commit: v.git_commit }),
  (error: Error) => ({ version: `failed: ${error.message}`, commit: null }),
);

export default function About() {
  const found = use(engineFacts);
  return (
    <div className={styles.about}>
      <Popover.Title className={styles.title}>
        <Logo />
        About DDALAB
      </Popover.Title>
      <p className={styles.byline}>By Simon Dräger, Claudia Lainscsek and Terrence J. Sejnowski</p>
      <dl className={styles.facts}>
        <dt>Version</dt>
        <dd>{version}</dd>
        <dt>Engine</dt>
        <dd>{found.version}</dd>
        <dt>Commit</dt>
        <dd>{found.commit ? <code>{found.commit}</code> : "not recorded in this build"}</dd>
      </dl>
      <section aria-labelledby="keyboard-shortcuts" className={styles.section}>
        <h3 id="keyboard-shortcuts" className={styles.heading}>
          Keyboard shortcuts
        </h3>
        <KeyList />
      </section>
      <p className={styles.text}>
        Install DDALAB from your browser's menu to use it offline in its own window.
      </p>
      <section aria-labelledby="color-maps" className={styles.section}>
        <h3 id="color-maps" className={styles.heading}>
          Color maps
        </h3>
        <p className={styles.text}>
          The heatmap uses batlow, vik and berlin from Fabio Crameri's Scientific colour maps. Crameri, F.
          (2018). Scientific colour maps. Zenodo. doi:10.5281/zenodo.1243862
        </p>
        <p className={styles.text}>MIT License, Copyright (c) 2020 Fabio Crameri</p>
      </section>
    </div>
  );
}

/** Every shortcut beside what it does, set as labeled fields: the application menu's, then the tabs'. */
function KeyList() {
  return (
    <>
      <dl className={styles.keys}>
        {[...MENU_KEYS, ...TAB_KEYS].map(([keys, action]) => (
          <div key={keys}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      {LINUX_NOTE && <p className={styles.text}>{LINUX_NOTE}</p>}
    </>
  );
}

/** The list of shortcuts on its own, from Help > Keyboard shortcuts. */
export function Shortcuts() {
  return (
    <div className={styles.about}>
      <Popover.Title className={styles.title}>Keyboard shortcuts</Popover.Title>
      <KeyList />
    </div>
  );
}
