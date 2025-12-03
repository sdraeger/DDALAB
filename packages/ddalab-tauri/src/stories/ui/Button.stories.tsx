import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "@/components/ui/button";
import { Download, Plus, Trash2, Settings, Play } from "lucide-react";

/**
 * Button component with multiple variants and sizes.
 * Built with Radix UI Slot for composition and CVA for variant styles.
 */
const meta: Meta<typeof Button> = {
  title: "UI/Button",
  component: Button,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A versatile button component supporting multiple variants, sizes, and loading states. Uses CVA for variant management.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "destructive",
        "outline",
        "secondary",
        "ghost",
        "link",
      ],
      description: "The visual style of the button",
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg", "icon"],
      description: "The size of the button",
    },
    isLoading: {
      control: "boolean",
      description: "Shows loading spinner and disables the button",
    },
    loadingText: {
      control: "text",
      description: "Text to show while loading",
    },
    disabled: {
      control: "boolean",
      description: "Disables the button",
    },
    asChild: {
      control: "boolean",
      description: "Renders as child element (for composition)",
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic variants
export const Default: Story = {
  args: {
    children: "Default Button",
    variant: "default",
  },
};

export const Destructive: Story = {
  args: {
    children: "Delete",
    variant: "destructive",
  },
};

export const Outline: Story = {
  args: {
    children: "Outline",
    variant: "outline",
  },
};

export const Secondary: Story = {
  args: {
    children: "Secondary",
    variant: "secondary",
  },
};

export const Ghost: Story = {
  args: {
    children: "Ghost",
    variant: "ghost",
  },
};

export const Link: Story = {
  args: {
    children: "Link Button",
    variant: "link",
  },
};

// Sizes
export const Small: Story = {
  args: {
    children: "Small",
    size: "sm",
  },
};

export const Large: Story = {
  args: {
    children: "Large Button",
    size: "lg",
  },
};

export const Icon: Story = {
  args: {
    size: "icon",
    children: <Settings className="h-4 w-4" />,
  },
};

// States
export const Loading: Story = {
  args: {
    children: "Submit",
    isLoading: true,
  },
};

export const LoadingWithText: Story = {
  args: {
    children: "Submit",
    isLoading: true,
    loadingText: "Submitting...",
  },
};

export const Disabled: Story = {
  args: {
    children: "Disabled",
    disabled: true,
  },
};

// With icons
export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Download className="h-4 w-4" />
        Download
      </>
    ),
  },
};

export const IconRight: Story = {
  args: {
    children: (
      <>
        Continue
        <Play className="h-4 w-4" />
      </>
    ),
  },
};

// All variants showcase
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <Button variant="default">Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};

// All sizes showcase
export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon">
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  ),
};

// Real-world examples
export const ActionButtons: Story = {
  render: () => (
    <div className="flex gap-2">
      <Button variant="outline">Cancel</Button>
      <Button>Save Changes</Button>
    </div>
  ),
};

export const DangerZone: Story = {
  render: () => (
    <div className="p-4 border border-destructive/20 rounded-lg bg-destructive/5">
      <h3 className="font-semibold text-destructive mb-2">Danger Zone</h3>
      <p className="text-sm text-muted-foreground mb-4">
        This action cannot be undone.
      </p>
      <Button variant="destructive">
        <Trash2 className="h-4 w-4" />
        Delete Project
      </Button>
    </div>
  ),
};
