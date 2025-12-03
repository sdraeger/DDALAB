import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  FileText,
  Play,
  Settings,
  Download,
  MoreHorizontal,
} from "lucide-react";

/**
 * Card component for grouping related content.
 */
const meta: Meta<typeof Card> = {
  title: "UI/Card",
  component: Card,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A card component for grouping and containing related content. Includes header, content, and footer subcomponents.",
      },
    },
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic
export const Default: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>Card description goes here.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Card content with any components you need.</p>
      </CardContent>
    </Card>
  ),
};

export const WithFooter: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>Card description goes here.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Card content with any components you need.</p>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline">Cancel</Button>
        <Button>Save</Button>
      </CardFooter>
    </Card>
  ),
};

// File card (DDALAB specific)
export const FileCard: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">recording_001.edf</CardTitle>
              <CardDescription>EDF+ Format • 64 channels</CardDescription>
            </div>
          </div>
          <Badge variant="success">Loaded</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Duration</p>
            <p className="font-medium">2h 30m</p>
          </div>
          <div>
            <p className="text-muted-foreground">Sample Rate</p>
            <p className="font-medium">256 Hz</p>
          </div>
          <div>
            <p className="text-muted-foreground">File Size</p>
            <p className="font-medium">245 MB</p>
          </div>
          <div>
            <p className="text-muted-foreground">Date</p>
            <p className="font-medium">2024-01-15</p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1">
          <Settings className="h-4 w-4 mr-1" />
          Configure
        </Button>
        <Button size="sm" className="flex-1">
          <Play className="h-4 w-4 mr-1" />
          Analyze
        </Button>
      </CardFooter>
    </Card>
  ),
};

// Analysis progress card
export const AnalysisCard: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">DDA Analysis</CardTitle>
          <Badge variant="warning">Running</Badge>
        </div>
        <CardDescription>Processing channel data...</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Progress</span>
            <span className="font-medium">67%</span>
          </div>
          <Progress value={67} />
        </div>
        <div className="text-sm text-muted-foreground">
          Estimated time remaining: ~3 minutes
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full">
          Cancel Analysis
        </Button>
      </CardFooter>
    </Card>
  ),
};

// Settings card
export const SettingsCard: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle className="text-base">Analysis Settings</CardTitle>
        <CardDescription>
          Configure DDA parameters for your analysis.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="font-medium">Embedding Dimension</p>
            <p className="text-sm text-muted-foreground">m = 3</p>
          </div>
          <Button variant="ghost" size="icon">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex justify-between items-center">
          <div>
            <p className="font-medium">Time Delay</p>
            <p className="text-sm text-muted-foreground">τ = 1</p>
          </div>
          <Button variant="ghost" size="icon">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex justify-between items-center">
          <div>
            <p className="font-medium">Delta Range</p>
            <p className="text-sm text-muted-foreground">1 - 100</p>
          </div>
          <Button variant="ghost" size="icon">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  ),
};

// Result card
export const ResultCard: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Analysis Complete</CardTitle>
          <Badge variant="success">Done</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-muted-foreground">Channels</p>
            <p className="text-2xl font-bold">64</p>
          </div>
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-muted-foreground">Duration</p>
            <p className="text-2xl font-bold">2.5h</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Results saved to recording_001_dda_results.json
        </p>
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1">
          View Details
        </Button>
        <Button size="sm" className="flex-1">
          <Download className="h-4 w-4 mr-1" />
          Export
        </Button>
      </CardFooter>
    </Card>
  ),
};

// Minimal card
export const Minimal: Story = {
  render: () => (
    <Card className="w-[250px] p-4">
      <p className="text-sm text-muted-foreground">Total Files</p>
      <p className="text-3xl font-bold">24</p>
    </Card>
  ),
};

// Card grid
export const CardGrid: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Files Loaded</p>
        <p className="text-2xl font-bold">12</p>
      </Card>
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Channels</p>
        <p className="text-2xl font-bold">64</p>
      </Card>
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Analyses Run</p>
        <p className="text-2xl font-bold">8</p>
      </Card>
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">Duration</p>
        <p className="text-2xl font-bold">4.2h</p>
      </Card>
    </div>
  ),
};
