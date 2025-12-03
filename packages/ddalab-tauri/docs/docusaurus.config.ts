import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "DDALAB Documentation",
  tagline: "Delay Differential Analysis Laboratory",
  favicon: "img/favicon.ico",

  future: {
    v4: true,
  },

  url: "https://sdraeger.github.io",
  baseUrl: "/DDALAB/",

  organizationName: "sdraeger",
  projectName: "DDALAB",

  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          editUrl:
            "https://github.com/sdraeger/DDALAB/tree/main/packages/ddalab-tauri/docs/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/docusaurus-social-card.jpg",
    colorMode: {
      defaultMode: "light",
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "DDALAB",
      logo: {
        alt: "DDALAB Logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          to: "/docs/api/overview",
          label: "API Reference",
          position: "left",
        },
        {
          to: "/docs/components/overview",
          label: "Components",
          position: "left",
        },
        {
          href: "https://github.com/sdraeger/DDALAB",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Documentation",
          items: [
            {
              label: "Getting Started",
              to: "/docs/getting-started/installation",
            },
            {
              label: "User Guide",
              to: "/docs/user-guide/overview",
            },
            {
              label: "API Reference",
              to: "/docs/api/overview",
            },
          ],
        },
        {
          title: "Development",
          items: [
            {
              label: "Component Library",
              to: "/docs/components/overview",
            },
            {
              label: "Architecture",
              to: "/docs/development/architecture",
            },
            {
              label: "Contributing",
              to: "/docs/development/contributing",
            },
          ],
        },
        {
          title: "Community",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/sdraeger/DDALAB",
            },
            {
              label: "Issues",
              href: "https://github.com/sdraeger/DDALAB/issues",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} DDALAB. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["rust", "typescript", "bash", "json"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
