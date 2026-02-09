"use client";

import { SettingsLayout, SettingsSection } from "./settings/SettingsLayout";
import { GeneralSettings } from "./settings/GeneralSettings";
import { AnalysisEngineSettings } from "./settings/AnalysisEngineSettings";
import { BehaviorSettings } from "./settings/BehaviorSettings";
import { SecuritySettings } from "./settings/SecuritySettings";
import { NSGSettings } from "./settings/NSGSettings";
import { SyncSettings } from "./settings/SyncSettings";
import { OpenNeuroSettings } from "./settings/OpenNeuroSettings";
import { DebugSettings } from "./settings/DebugSettings";
import { UpdatesSettings } from "./settings/UpdatesSettings";
import { CLISettings } from "./settings/CLISettings";
import { PythonSettings } from "./settings/PythonSettings";
import { TauriService } from "@/services/tauriService";
import {
  Activity,
  Cloud,
  Code,
  FileText,
  Database,
  Shield,
  Download,
  Settings2,
  Sliders,
  Share2,
  Terminal,
} from "lucide-react";
import { useSearchableItems, createSettingsItem } from "@/hooks/useSearchable";

export function SettingsPanel() {
  // Register settings sections as searchable
  useSearchableItems(
    [
      createSettingsItem(
        "settings-general",
        "General Settings",
        () => {
          document
            .querySelector('[data-settings-section="general"]')
            ?.scrollIntoView();
        },
        {
          description: "Configure general preferences and expert mode",
          keywords: ["general", "expert", "mode", "advanced", "preferences"],
        },
      ),
      createSettingsItem(
        "settings-engine",
        "Analysis Engine Settings",
        () => {
          document
            .querySelector('[data-settings-section="engine"]')
            ?.scrollIntoView();
        },
        {
          description: "Configure DDA analysis engine and parallel processing",
          keywords: ["engine", "parallel", "cores", "dda", "configuration"],
        },
      ),
      ...(TauriService.isTauri()
        ? [
            createSettingsItem(
              "settings-behavior",
              "Behavior Settings",
              () => {
                document
                  .querySelector('[data-settings-section="behavior"]')
                  ?.scrollIntoView();
              },
              {
                description: "Configure application behavior and confirmations",
                keywords: [
                  "behavior",
                  "close",
                  "warning",
                  "confirmation",
                  "dialog",
                  "analysis",
                ],
              },
            ),
            createSettingsItem(
              "settings-cli",
              "CLI Settings",
              () => {
                document
                  .querySelector('[data-settings-section="cli"]')
                  ?.scrollIntoView();
              },
              {
                description: "Install ddalab command line interface to PATH",
                keywords: [
                  "cli",
                  "terminal",
                  "command",
                  "line",
                  "path",
                  "install",
                  "ddalab",
                  "shell",
                ],
              },
            ),
            createSettingsItem(
              "settings-python",
              "Python / MNE Settings",
              () => {
                document
                  .querySelector('[data-settings-section="python"]')
                  ?.scrollIntoView();
              },
              {
                description:
                  "Configure Python environment for MNE-Python file import",
                keywords: [
                  "python",
                  "mne",
                  "eeglab",
                  "import",
                  "bridge",
                  "matlab",
                  "hdf5",
                ],
              },
            ),
            createSettingsItem(
              "settings-security",
              "Security Settings",
              () => {
                document
                  .querySelector('[data-settings-section="security"]')
                  ?.scrollIntoView();
              },
              {
                description: "Configure API authentication and session tokens",
                keywords: ["security", "auth", "token", "session", "password"],
              },
            ),
            createSettingsItem(
              "settings-nsg",
              "NSG Integration Settings",
              () => {
                document
                  .querySelector('[data-settings-section="nsg"]')
                  ?.scrollIntoView();
              },
              {
                description: "Configure Neuroscience Gateway credentials",
                keywords: ["nsg", "gateway", "credentials", "hpc", "username"],
              },
            ),
            createSettingsItem(
              "settings-sync",
              "Sync & Sharing Settings",
              () => {
                document
                  .querySelector('[data-settings-section="sync"]')
                  ?.scrollIntoView();
              },
              {
                description: "Connect to sync broker and share results",
                keywords: ["sync", "share", "broker", "peer", "collaboration"],
              },
            ),
            createSettingsItem(
              "settings-debug",
              "Debug & Logs Settings",
              () => {
                document
                  .querySelector('[data-settings-section="debug"]')
                  ?.scrollIntoView();
              },
              {
                description: "View application logs and debug information",
                keywords: ["debug", "logs", "diagnostics", "errors", "console"],
              },
            ),
            createSettingsItem(
              "settings-updates",
              "Updates Settings",
              () => {
                document
                  .querySelector('[data-settings-section="updates"]')
                  ?.scrollIntoView();
              },
              {
                description: "Check for application updates",
                keywords: ["update", "version", "upgrade", "new", "download"],
              },
            ),
          ]
        : []),
      createSettingsItem(
        "settings-openneuro",
        "OpenNeuro Settings",
        () => {
          document
            .querySelector('[data-settings-section="openneuro"]')
            ?.scrollIntoView();
        },
        {
          description: "Configure OpenNeuro API key for dataset access",
          keywords: ["openneuro", "api", "key", "dataset", "download"],
        },
      ),
    ],
    [],
  );

  const sections: SettingsSection[] = [
    {
      id: "general",
      label: "General",
      icon: <Sliders className="h-4 w-4" />,
      component: <GeneralSettings />,
      keywords: ["general", "expert", "mode", "advanced", "preferences"],
      description: "Configure general preferences and expert mode",
    },
    {
      id: "engine",
      label: "Analysis Engine",
      icon: <Activity className="h-4 w-4" />,
      component: <AnalysisEngineSettings />,
      keywords: [
        "dda",
        "parallel",
        "cores",
        "processing",
        "threads",
        "cpu",
        "workers",
      ],
      description: "Configure DDA analysis engine and parallel processing",
    },
  ];

  // Only add Behavior section in Tauri (close warning is Tauri-only)
  if (TauriService.isTauri()) {
    sections.push({
      id: "behavior",
      label: "Behavior",
      icon: <Settings2 className="h-4 w-4" />,
      component: <BehaviorSettings />,
      keywords: ["close", "warning", "confirm", "dialog", "prompt", "exit"],
      description: "Configure application behavior and confirmations",
    });
  }

  // Only add CLI section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: "cli",
      label: "CLI",
      icon: <Terminal className="h-4 w-4" />,
      component: <CLISettings />,
      keywords: [
        "cli",
        "terminal",
        "command",
        "line",
        "path",
        "install",
        "shell",
      ],
      description: "Install ddalab command line interface to PATH",
    });
  }

  // Only add Python/MNE section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: "python",
      label: "Python / MNE",
      icon: <Code className="h-4 w-4" />,
      component: <PythonSettings />,
      keywords: [
        "python",
        "mne",
        "eeglab",
        "import",
        "bridge",
        "matlab",
        "hdf5",
      ],
      description: "Configure Python environment for MNE-Python file import",
    });
  }

  // Only add Security section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: "security",
      label: "Security",
      icon: <Shield className="h-4 w-4" />,
      component: <SecuritySettings />,
      keywords: ["token", "auth", "session", "password", "api", "credentials"],
      description: "Configure API authentication and session tokens",
    });
  }

  // Only add NSG section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: "nsg",
      label: "NSG Integration",
      icon: <Cloud className="h-4 w-4" />,
      component: <NSGSettings />,
      keywords: [
        "neuroscience",
        "gateway",
        "hpc",
        "computing",
        "jobs",
        "remote",
      ],
      description: "Configure Neuroscience Gateway credentials for HPC jobs",
    });
  }

  // Only add Sync section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: "sync",
      label: "Sync & Sharing",
      icon: <Share2 className="h-4 w-4" />,
      component: <SyncSettings />,
      keywords: [
        "sync",
        "share",
        "broker",
        "peer",
        "collaboration",
        "team",
        "results",
      ],
      description: "Connect to sync broker to share analysis results",
    });
  }

  // OpenNeuro section (available in both Tauri and web)
  sections.push({
    id: "openneuro",
    label: "OpenNeuro",
    icon: <Database className="h-4 w-4" />,
    component: <OpenNeuroSettings />,
    keywords: ["dataset", "download", "api", "key", "bids", "neuroimaging"],
    description: "Configure OpenNeuro API key for dataset access",
  });

  // Only add Debug section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: "debug",
      label: "Debug & Logs",
      icon: <FileText className="h-4 w-4" />,
      component: <DebugSettings />,
      keywords: ["logs", "diagnostics", "errors", "console", "troubleshoot"],
      description: "View application logs and debug information",
    });
  }

  // Only add Updates section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: "updates",
      label: "Updates",
      icon: <Download className="h-4 w-4" />,
      component: <UpdatesSettings />,
      keywords: ["version", "upgrade", "new", "release", "check"],
      description: "Check for and install application updates",
    });
  }

  return <SettingsLayout sections={sections} defaultSection="general" />;
}
