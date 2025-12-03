import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useState } from "react";

/**
 * Switch component for toggling boolean states.
 */
const meta: Meta<typeof Switch> = {
  title: "UI/Switch",
  component: Switch,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A toggle switch component built on Radix UI Switch for binary on/off states.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    checked: {
      control: "boolean",
      description: "Whether the switch is on",
    },
    disabled: {
      control: "boolean",
      description: "Whether the switch is disabled",
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic
export const Default: Story = {
  args: {},
};

export const Checked: Story = {
  args: {
    checked: true,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const DisabledChecked: Story = {
  args: {
    disabled: true,
    checked: true,
  },
};

// With label
export const WithLabel: Story = {
  render: () => (
    <div className="flex items-center space-x-2">
      <Switch id="airplane-mode" />
      <Label htmlFor="airplane-mode">Airplane Mode</Label>
    </div>
  ),
};

// Interactive
export const Interactive: Story = {
  render: function InteractiveSwitch() {
    const [checked, setChecked] = useState(false);
    return (
      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <Switch
            id="interactive"
            checked={checked}
            onCheckedChange={setChecked}
          />
          <Label htmlFor="interactive">Toggle me</Label>
        </div>
        <p className="text-sm text-muted-foreground">
          Switch is: {checked ? "ON" : "OFF"}
        </p>
      </div>
    );
  },
};

// Settings example (DDALAB specific)
export const SettingsToggles: Story = {
  render: function SettingsExample() {
    const [settings, setSettings] = useState({
      autoSave: true,
      darkMode: false,
      notifications: true,
      debugMode: false,
    });

    const toggle = (key: keyof typeof settings) => {
      setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    return (
      <div className="w-[300px] space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="auto-save">Auto-save results</Label>
            <p className="text-xs text-muted-foreground">
              Automatically save after analysis
            </p>
          </div>
          <Switch
            id="auto-save"
            checked={settings.autoSave}
            onCheckedChange={() => toggle("autoSave")}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="dark-mode">Dark mode</Label>
            <p className="text-xs text-muted-foreground">Use dark theme</p>
          </div>
          <Switch
            id="dark-mode"
            checked={settings.darkMode}
            onCheckedChange={() => toggle("darkMode")}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="notifications">Notifications</Label>
            <p className="text-xs text-muted-foreground">
              Show completion alerts
            </p>
          </div>
          <Switch
            id="notifications"
            checked={settings.notifications}
            onCheckedChange={() => toggle("notifications")}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="debug">Debug mode</Label>
            <p className="text-xs text-muted-foreground">
              Show verbose logging
            </p>
          </div>
          <Switch
            id="debug"
            checked={settings.debugMode}
            onCheckedChange={() => toggle("debugMode")}
          />
        </div>
      </div>
    );
  },
};

// Analysis options
export const AnalysisOptions: Story = {
  render: () => (
    <div className="w-[300px] p-4 border rounded-lg space-y-4">
      <h3 className="font-semibold">Analysis Options</h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="normalize">Normalize data</Label>
          <Switch id="normalize" defaultChecked />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="detrend">Detrend signals</Label>
          <Switch id="detrend" defaultChecked />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="bandpass">Apply bandpass filter</Label>
          <Switch id="bandpass" />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="parallel">Parallel processing</Label>
          <Switch id="parallel" defaultChecked />
        </div>
      </div>
    </div>
  ),
};

// With description
export const WithDescription: Story = {
  render: () => (
    <div className="flex items-start space-x-3 w-[350px]">
      <Switch id="marketing" className="mt-1" />
      <div>
        <Label htmlFor="marketing" className="font-medium">
          Marketing emails
        </Label>
        <p className="text-sm text-muted-foreground">
          Receive emails about new features, tips, and DDALAB updates.
        </p>
      </div>
    </div>
  ),
};

// Form row style
export const FormRow: Story = {
  render: () => (
    <div className="w-[400px] space-y-4">
      <div className="flex items-center justify-between py-2 border-b">
        <div>
          <p className="font-medium">Auto-backup</p>
          <p className="text-sm text-muted-foreground">
            Create automatic backups
          </p>
        </div>
        <Switch />
      </div>
      <div className="flex items-center justify-between py-2 border-b">
        <div>
          <p className="font-medium">Cloud sync</p>
          <p className="text-sm text-muted-foreground">
            Sync results to cloud storage
          </p>
        </div>
        <Switch />
      </div>
      <div className="flex items-center justify-between py-2">
        <div>
          <p className="font-medium">Telemetry</p>
          <p className="text-sm text-muted-foreground">Help improve DDALAB</p>
        </div>
        <Switch defaultChecked />
      </div>
    </div>
  ),
};
