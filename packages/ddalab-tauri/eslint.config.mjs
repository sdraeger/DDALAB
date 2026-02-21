import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import storybook from "eslint-plugin-storybook";

export default [
  ...nextCoreWebVitals,
  ...storybook.configs["flat/recommended"],
  {
    ignores: [
      ".next/**",
      "out/**",
      "coverage/**",
      "coverage-e2e/**",
      "e2e-report/**",
      "test-results/**",
      "src-tauri/target/**",
      "docs-dist/**",
      "docs/.docusaurus/**",
      "node_modules/**",
    ],
  },
  {
    files: ["e2e/**/*.ts", "e2e/**/*.tsx"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/refs": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/globals": "off",
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  {
    rules: {
      "no-console": [
        "warn",
        {
          allow: ["warn", "error", "info"],
        },
      ],
    },
  },
];
