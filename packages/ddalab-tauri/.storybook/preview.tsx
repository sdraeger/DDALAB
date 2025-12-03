import type { Preview } from "@storybook/nextjs-vite";
import "../src/app/globals.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "light",
      values: [
        { name: "light", value: "#ffffff" },
        { name: "dark", value: "#0a0a0a" },
      ],
    },
    layout: "centered",
  },
  decorators: [
    (Story, context) => {
      // Apply dark mode class based on background
      const isDark = context.globals.backgrounds?.value === "#0a0a0a";
      return (
        <div className={isDark ? "dark" : ""}>
          <div className="bg-background text-foreground p-4">
            <Story />
          </div>
        </div>
      );
    },
  ],
  globalTypes: {
    theme: {
      description: "Theme for components",
      defaultValue: "light",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
};

export default preview;
