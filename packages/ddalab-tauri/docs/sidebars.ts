import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",
    {
      type: "category",
      label: "Getting Started",
      items: [
        "getting-started/installation",
        "getting-started/quick-start",
        "getting-started/first-analysis",
      ],
    },
    {
      type: "category",
      label: "User Guide",
      items: [
        "user-guide/overview",
        "user-guide/file-formats",
        "user-guide/dda-analysis",
        "user-guide/visualization",
        "user-guide/export",
      ],
    },
    {
      type: "category",
      label: "API Reference",
      items: ["api/overview", "api/typescript", "api/rust"],
    },
    {
      type: "category",
      label: "Components",
      items: [
        "components/overview",
        "components/ui-components",
        "components/feature-components",
      ],
    },
    {
      type: "category",
      label: "Development",
      items: [
        "development/architecture",
        "development/contributing",
        "development/testing",
      ],
    },
  ],
};

export default sidebars;
