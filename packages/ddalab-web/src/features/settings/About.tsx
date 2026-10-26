// About DDALAB, from the command bar: the app's version, the engine that runs the analyses, and the citation and
// license notice the heatmap's color maps come with (render/colormaps.ts).
import { Popover } from "@base-ui/react/popover";
import { use } from "react";
import { version } from "../../../package.json";
import { engineVersion } from "../../app/analyses";
import { Logo } from "../../app/Logo";
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
      <dl className={styles.facts}>
        <dt>Version</dt>
        <dd>{version}</dd>
        <dt>Engine</dt>
        <dd>{found.version}</dd>
        <dt>Commit</dt>
        <dd>{found.commit ? <code>{found.commit}</code> : "not recorded in this build"}</dd>
      </dl>
      <p className={styles.text}>
        The heatmap colors are Crameri's batlow and vik. Crameri, F. (2018). Scientific colour maps. Zenodo.
        doi:10.5281/zenodo.1243862
      </p>
      <p className={styles.text}>MIT License, Copyright (c) 2020 Fabio Crameri</p>
    </div>
  );
}
