import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Badge } from "@/components/ui/badge";
import { Check, X, AlertTriangle, Info, Clock, Zap } from "lucide-react";

/**
 * Badge component for displaying status, labels, and counts.
 */
const meta: Meta<typeof Badge> = {
  title: "UI/Badge",
  component: Badge,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A badge component for displaying status indicators, labels, counts, and tags. Supports multiple semantic variants.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "secondary",
        "destructive",
        "outline",
        "success",
        "warning",
        "muted",
      ],
      description: "The visual style of the badge",
    },
    children: {
      control: "text",
      description: "Badge content",
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Variants
export const Default: Story = {
  args: {
    children: "Default",
    variant: "default",
  },
};

export const Secondary: Story = {
  args: {
    children: "Secondary",
    variant: "secondary",
  },
};

export const Destructive: Story = {
  args: {
    children: "Error",
    variant: "destructive",
  },
};

export const Outline: Story = {
  args: {
    children: "Outline",
    variant: "outline",
  },
};

export const Success: Story = {
  args: {
    children: "Success",
    variant: "success",
  },
};

export const Warning: Story = {
  args: {
    children: "Warning",
    variant: "warning",
  },
};

export const Muted: Story = {
  args: {
    children: "Muted",
    variant: "muted",
  },
};

// All variants showcase
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="muted">Muted</Badge>
    </div>
  ),
};

// With icons
export const WithCheckIcon: Story = {
  render: () => (
    <Badge variant="success" className="gap-1">
      <Check className="h-3 w-3" />
      Complete
    </Badge>
  ),
};

export const WithErrorIcon: Story = {
  render: () => (
    <Badge variant="destructive" className="gap-1">
      <X className="h-3 w-3" />
      Failed
    </Badge>
  ),
};

export const WithWarningIcon: Story = {
  render: () => (
    <Badge variant="warning" className="gap-1">
      <AlertTriangle className="h-3 w-3" />
      Pending
    </Badge>
  ),
};

// Status badges
export const StatusBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="success" className="gap-1">
        <Check className="h-3 w-3" />
        Running
      </Badge>
      <Badge variant="warning" className="gap-1">
        <Clock className="h-3 w-3" />
        Pending
      </Badge>
      <Badge variant="destructive" className="gap-1">
        <X className="h-3 w-3" />
        Stopped
      </Badge>
      <Badge variant="muted" className="gap-1">
        <Info className="h-3 w-3" />
        Idle
      </Badge>
    </div>
  ),
};

// File format badges (DDALAB specific)
export const FileFormats: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">EDF</Badge>
      <Badge variant="secondary">CSV</Badge>
      <Badge variant="outline">XDF</Badge>
      <Badge variant="muted">NWB</Badge>
      <Badge variant="default">BrainVision</Badge>
    </div>
  ),
};

// Count badges
export const CountBadges: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm">Channels</span>
        <Badge variant="secondary">64</Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm">Files</span>
        <Badge variant="secondary">12</Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm">Errors</span>
        <Badge variant="destructive">3</Badge>
      </div>
    </div>
  ),
};

// Feature badges
export const FeatureBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default" className="gap-1">
        <Zap className="h-3 w-3" />
        New
      </Badge>
      <Badge variant="outline">Beta</Badge>
      <Badge variant="secondary">Pro</Badge>
      <Badge variant="muted">Legacy</Badge>
    </div>
  ),
};

// In context
export const InContext: Story = {
  render: () => (
    <div className="p-4 border rounded-lg space-y-3 w-[300px]">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">DDA Analysis</h3>
        <Badge variant="success">Complete</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Processed 64 channels across 3 files
      </p>
      <div className="flex gap-2">
        <Badge variant="outline">EDF</Badge>
        <Badge variant="muted">2.4 MB</Badge>
      </div>
    </div>
  ),
};
