import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, Settings, BarChart2, Play, Download } from "lucide-react";

/**
 * Tabs component for organizing content into sections.
 */
const meta: Meta<typeof Tabs> = {
  title: "UI/Tabs",
  component: Tabs,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A tabs component built on Radix UI Tabs for organizing content into switchable sections.",
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
    <Tabs defaultValue="tab1" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="tab1">Tab 1</TabsTrigger>
        <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        <TabsTrigger value="tab3">Tab 3</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1" className="p-4">
        Content for Tab 1
      </TabsContent>
      <TabsContent value="tab2" className="p-4">
        Content for Tab 2
      </TabsContent>
      <TabsContent value="tab3" className="p-4">
        Content for Tab 3
      </TabsContent>
    </Tabs>
  ),
};

// With icons
export const WithIcons: Story = {
  render: () => (
    <Tabs defaultValue="files" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="files" className="gap-2">
          <FileText className="h-4 w-4" />
          Files
        </TabsTrigger>
        <TabsTrigger value="analysis" className="gap-2">
          <BarChart2 className="h-4 w-4" />
          Analysis
        </TabsTrigger>
        <TabsTrigger value="settings" className="gap-2">
          <Settings className="h-4 w-4" />
          Settings
        </TabsTrigger>
      </TabsList>
      <TabsContent value="files" className="p-4">
        <p className="text-muted-foreground">Manage your data files here.</p>
      </TabsContent>
      <TabsContent value="analysis" className="p-4">
        <p className="text-muted-foreground">View analysis results.</p>
      </TabsContent>
      <TabsContent value="settings" className="p-4">
        <p className="text-muted-foreground">Configure analysis settings.</p>
      </TabsContent>
    </Tabs>
  ),
};

// Full width
export const FullWidth: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-[500px]">
      <TabsList className="w-full">
        <TabsTrigger value="overview" className="flex-1">
          Overview
        </TabsTrigger>
        <TabsTrigger value="channels" className="flex-1">
          Channels
        </TabsTrigger>
        <TabsTrigger value="results" className="flex-1">
          Results
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="p-4">
        Overview content
      </TabsContent>
      <TabsContent value="channels" className="p-4">
        Channels content
      </TabsContent>
      <TabsContent value="results" className="p-4">
        Results content
      </TabsContent>
    </Tabs>
  ),
};

// DDA Analysis tabs (DDALAB specific)
export const DDAAnalysisTabs: Story = {
  render: () => (
    <Card className="w-[500px]">
      <CardHeader>
        <CardTitle>DDA Analysis</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="config">
          <TabsList className="w-full">
            <TabsTrigger value="config" className="flex-1">
              Configuration
            </TabsTrigger>
            <TabsTrigger value="channels" className="flex-1">
              Channels
            </TabsTrigger>
            <TabsTrigger value="preview" className="flex-1">
              Preview
            </TabsTrigger>
          </TabsList>
          <TabsContent value="config" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Embedding Dimension (m)</Label>
                <Input type="number" defaultValue="3" />
              </div>
              <div className="space-y-2">
                <Label>Time Delay (τ)</Label>
                <Input type="number" defaultValue="1" />
              </div>
            </div>
            <Button className="w-full">
              <Play className="h-4 w-4 mr-2" />
              Run Analysis
            </Button>
          </TabsContent>
          <TabsContent value="channels" className="pt-4">
            <p className="text-muted-foreground">
              Select channels to include in analysis.
            </p>
          </TabsContent>
          <TabsContent value="preview" className="pt-4">
            <p className="text-muted-foreground">
              Preview selected data before running analysis.
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  ),
};

// Settings tabs
export const SettingsTabs: Story = {
  render: () => (
    <div className="w-[500px] border rounded-lg">
      <Tabs defaultValue="general" className="flex h-[300px]">
        <TabsList className="flex flex-col h-full w-[150px] rounded-none border-r bg-muted/50 p-1">
          <TabsTrigger
            value="general"
            className="w-full justify-start px-3 data-[state=active]:bg-background"
          >
            General
          </TabsTrigger>
          <TabsTrigger
            value="analysis"
            className="w-full justify-start px-3 data-[state=active]:bg-background"
          >
            Analysis
          </TabsTrigger>
          <TabsTrigger
            value="display"
            className="w-full justify-start px-3 data-[state=active]:bg-background"
          >
            Display
          </TabsTrigger>
          <TabsTrigger
            value="export"
            className="w-full justify-start px-3 data-[state=active]:bg-background"
          >
            Export
          </TabsTrigger>
        </TabsList>
        <div className="flex-1 p-4">
          <TabsContent value="general" className="mt-0">
            <h3 className="font-semibold mb-2">General Settings</h3>
            <p className="text-sm text-muted-foreground">
              Configure general application preferences.
            </p>
          </TabsContent>
          <TabsContent value="analysis" className="mt-0">
            <h3 className="font-semibold mb-2">Analysis Settings</h3>
            <p className="text-sm text-muted-foreground">
              Configure DDA analysis parameters.
            </p>
          </TabsContent>
          <TabsContent value="display" className="mt-0">
            <h3 className="font-semibold mb-2">Display Settings</h3>
            <p className="text-sm text-muted-foreground">
              Configure visualization options.
            </p>
          </TabsContent>
          <TabsContent value="export" className="mt-0">
            <h3 className="font-semibold mb-2">Export Settings</h3>
            <p className="text-sm text-muted-foreground">
              Configure export formats and options.
            </p>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  ),
};

// Results tabs
export const ResultsTabs: Story = {
  render: () => (
    <Tabs defaultValue="summary" className="w-[500px]">
      <TabsList>
        <TabsTrigger value="summary">Summary</TabsTrigger>
        <TabsTrigger value="data">Data</TabsTrigger>
        <TabsTrigger value="export">Export</TabsTrigger>
      </TabsList>
      <TabsContent value="summary" className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">Channels</p>
            <p className="text-xl font-bold">64</p>
          </div>
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">Duration</p>
            <p className="text-xl font-bold">2.5h</p>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="data" className="p-4">
        <p className="text-muted-foreground">
          Raw data table would be displayed here.
        </p>
      </TabsContent>
      <TabsContent value="export" className="p-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Export results in various formats.
        </p>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            CSV
          </Button>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            JSON
          </Button>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            MAT
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  ),
};

// Disabled tab
export const WithDisabledTab: Story = {
  render: () => (
    <Tabs defaultValue="tab1" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="tab1">Available</TabsTrigger>
        <TabsTrigger value="tab2">Also Available</TabsTrigger>
        <TabsTrigger value="tab3" disabled>
          Disabled
        </TabsTrigger>
      </TabsList>
      <TabsContent value="tab1" className="p-4">
        This tab is available
      </TabsContent>
      <TabsContent value="tab2" className="p-4">
        This tab is also available
      </TabsContent>
    </Tabs>
  ),
};
