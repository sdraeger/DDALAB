import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Progress } from "@/components/ui/progress";
import { useEffect, useState } from "react";

/**
 * Progress component for displaying completion status.
 */
const meta: Meta<typeof Progress> = {
  title: "UI/Progress",
  component: Progress,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A progress indicator component built on Radix UI Progress. Shows determinate progress with smooth animations.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    value: {
      control: { type: "range", min: 0, max: 100, step: 1 },
      description: "Progress value (0-100)",
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic values
export const Default: Story = {
  args: {
    value: 50,
    className: "w-[300px]",
  },
};

export const Empty: Story = {
  args: {
    value: 0,
    className: "w-[300px]",
  },
};

export const Quarter: Story = {
  args: {
    value: 25,
    className: "w-[300px]",
  },
};

export const Half: Story = {
  args: {
    value: 50,
    className: "w-[300px]",
  },
};

export const ThreeQuarters: Story = {
  args: {
    value: 75,
    className: "w-[300px]",
  },
};

export const Complete: Story = {
  args: {
    value: 100,
    className: "w-[300px]",
  },
};

// Sizes
export const Small: Story = {
  args: {
    value: 60,
    className: "w-[300px] h-2",
  },
};

export const Large: Story = {
  args: {
    value: 60,
    className: "w-[300px] h-6",
  },
};

// Animated progress
export const Animated: Story = {
  render: function AnimatedProgress() {
    const [progress, setProgress] = useState(0);

    useEffect(() => {
      const interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) return 0;
          return prev + 1;
        });
      }, 50);
      return () => clearInterval(interval);
    }, []);

    return (
      <div className="w-[300px] space-y-2">
        <Progress value={progress} />
        <p className="text-sm text-center text-muted-foreground">{progress}%</p>
      </div>
    );
  },
};

// With label
export const WithLabel: Story = {
  render: () => (
    <div className="w-[300px] space-y-2">
      <div className="flex justify-between text-sm">
        <span>Progress</span>
        <span className="font-medium">67%</span>
      </div>
      <Progress value={67} />
    </div>
  ),
};

// DDA Analysis progress
export const DDAProgress: Story = {
  render: function DDAProgressDemo() {
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState("Initializing...");

    useEffect(() => {
      const statuses = [
        { value: 10, text: "Loading file..." },
        { value: 25, text: "Parsing channels..." },
        { value: 40, text: "Computing embeddings..." },
        { value: 60, text: "Calculating derivatives..." },
        { value: 80, text: "Generating results..." },
        { value: 100, text: "Complete!" },
      ];

      let index = 0;
      const interval = setInterval(() => {
        if (index < statuses.length) {
          setProgress(statuses[index].value);
          setStatus(statuses[index].text);
          index++;
        } else {
          clearInterval(interval);
        }
      }, 1000);

      return () => clearInterval(interval);
    }, []);

    return (
      <div className="w-[350px] p-4 border rounded-lg space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">DDA Analysis</h3>
          <span className="text-sm text-primary font-medium">{progress}%</span>
        </div>
        <Progress value={progress} className="h-2" />
        <p className="text-sm text-muted-foreground">{status}</p>
      </div>
    );
  },
};

// File upload progress
export const FileUploadProgress: Story = {
  render: () => (
    <div className="w-[350px] p-4 border rounded-lg space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="font-medium text-sm">recording_001.edf</p>
          <p className="text-xs text-muted-foreground">245 MB • 2.1 MB/s</p>
        </div>
        <span className="text-sm font-medium">78%</span>
      </div>
      <Progress value={78} className="h-1" />
    </div>
  ),
};

// Multiple progress bars
export const MultipleProgress: Story = {
  render: () => (
    <div className="w-[350px] space-y-4">
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>Channel 1</span>
          <span>100%</span>
        </div>
        <Progress value={100} className="h-2" />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>Channel 2</span>
          <span>75%</span>
        </div>
        <Progress value={75} className="h-2" />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>Channel 3</span>
          <span>45%</span>
        </div>
        <Progress value={45} className="h-2" />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>Channel 4</span>
          <span>20%</span>
        </div>
        <Progress value={20} className="h-2" />
      </div>
    </div>
  ),
};

// All sizes
export const AllSizes: Story = {
  render: () => (
    <div className="w-[300px] space-y-4">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Extra small (h-1)</p>
        <Progress value={60} className="h-1" />
      </div>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Small (h-2)</p>
        <Progress value={60} className="h-2" />
      </div>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Default (h-4)</p>
        <Progress value={60} />
      </div>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Large (h-6)</p>
        <Progress value={60} className="h-6" />
      </div>
    </div>
  ),
};
