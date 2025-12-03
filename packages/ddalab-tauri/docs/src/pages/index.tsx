import type { ReactNode } from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";

import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero hero--primary", styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className="button button--secondary button--lg" to="/docs/">
            Get Started
          </Link>
          <Link
            className="button button--outline button--lg"
            style={{ marginLeft: "1rem", color: "white", borderColor: "white" }}
            to="/docs/api/overview"
          >
            API Reference
          </Link>
        </div>
      </div>
    </header>
  );
}

function Feature({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <div className={clsx("col col--4")}>
      <div className="text--center" style={{ fontSize: "3rem" }}>
        {icon}
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          <Feature
            icon="📊"
            title="Multi-format Support"
            description="Load EDF, BrainVision, XDF, EEGLAB, FIF, NIfTI, and more neurophysiology file formats."
          />
          <Feature
            icon="⚡"
            title="Fast DDA Analysis"
            description="Native Rust implementation for high-performance Delay Differential Analysis."
          />
          <Feature
            icon="🎨"
            title="Interactive Visualization"
            description="Real-time time series plotting with zoom, pan, and channel selection."
          />
        </div>
        <div className="row" style={{ marginTop: "2rem" }}>
          <Feature
            icon="📦"
            title="Export Options"
            description="Export results to CSV, JSON, MATLAB, or EDF formats for further analysis."
          />
          <Feature
            icon="🔧"
            title="Modern Stack"
            description="Built with React, Next.js, and Tauri for a native cross-platform experience."
          />
          <Feature
            icon="📚"
            title="Well Documented"
            description="Comprehensive documentation with Storybook, TypeDoc, and rustdoc."
          />
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title="Home"
      description="DDALAB - Delay Differential Analysis Laboratory for neurophysiology data"
    >
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
