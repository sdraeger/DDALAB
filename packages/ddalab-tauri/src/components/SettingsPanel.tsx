"use client";

import { useMemo } from "react";
import { SettingsLayout, SettingsSection } from "./settings/SettingsLayout";
import { GeneralSettings } from "./settings/GeneralSettings";
import { BehaviorSettings } from "./settings/BehaviorSettings";
import { SecuritySettings } from "./settings/SecuritySettings";
import { NSGSettings } from "./settings/NSGSettings";
import { SyncSettings } from "./settings/SyncSettings";
import { OpenNeuroSettings } from "./settings/OpenNeuroSettings";
import { DebugSettings } from "./settings/DebugSettings";
import { UpdatesSettings } from "./settings/UpdatesSettings";
import { CLISettings } from "./settings/CLISettings";
import { PythonSettings } from "./settings/PythonSettings";
import {
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
import { useIsTauriRuntime } from "@/hooks/useIsTauriRuntime";

function scrollToSettingsSection(sectionId: string): void {
  document
    .querySelector(`[data-settings-section="${sectionId}"]`)
    ?.scrollIntoView();
}

export function SettingsPanel() {
  const isTauriRuntime = useIsTauriRuntime();

  const searchableItems = useMemo(
    () => [
      createSettingsItem(
        "settings-general",
        "General Settings",
        () => scrollToSettingsSection("general"),
        {
          description: "Configure general preferences and expert mode",
          keywords: ["general", "expert", "mode", "advanced", "preferences"],
        },
      ),
      ...(isTauriRuntime
        ? [
            createSettingsItem(
              "settings-behavior",
              "Behavior Settings",
              () => scrollToSettingsSection("behavior"),
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
              () => scrollToSettingsSection("cli"),
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
              () => scrollToSettingsSection("python"),
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
              () => scrollToSettingsSection("security"),
              {
                description: "Desktop security and local processing safeguards",
                keywords: ["security", "auth", "token", "session", "password"],
              },
            ),
            createSettingsItem(
              "settings-nsg",
              "NSG Integration Settings",
              () => scrollToSettingsSection("nsg"),
              {
                description: "Configure Neuroscience Gateway credentials",
                keywords: ["nsg", "gateway", "credentials", "hpc", "username"],
              },
            ),
            createSettingsItem(
              "settings-sync",
              "Sync & Sharing Settings",
              () => scrollToSettingsSection("sync"),
              {
                description: "Connect to sync broker and share results",
                keywords: ["sync", "share", "broker", "peer", "collaboration"],
              },
            ),
            createSettingsItem(
              "settings-debug",
              "Debug & Logs Settings",
              () => scrollToSettingsSection("debug"),
              {
                description: "View application logs and debug information",
                keywords: ["debug", "logs", "diagnostics", "errors", "console"],
              },
            ),
            createSettingsItem(
              "settings-updates",
              "Updates Settings",
              () => scrollToSettingsSection("updates"),
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
        () => scrollToSettingsSection("openneuro"),
        {
          description: "Configure OpenNeuro API key for dataset access",
          keywords: ["openneuro", "api", "key", "dataset", "download"],
        },
      ),
    ],
    [isTauriRuntime],
  );

  // Register settings sections as searchable.
  useSearchableItems(searchableItems, [isTauriRuntime]);

  const sections = useMemo<SettingsSection[]>(() => {
    const result: SettingsSection[] = [
      {
        id: "general",
        label: "General",
        icon: <Sliders className="h-4 w-4" />,
        component: <GeneralSettings />,
        keywords: ["general", "expert", "mode", "advanced", "preferences"],
        description: "Configure general preferences and expert mode",
      },
    ];

    if (isTauriRuntime) {
      result.push({
        id: "behavior",
        label: "Behavior",
        icon: <Settings2 className="h-4 w-4" />,
        component: <BehaviorSettings />,
        keywords: ["close", "warning", "confirm", "dialog", "prompt", "exit"],
        description: "Configure application behavior and confirmations",
      });

      result.push({
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

      result.push({
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

      result.push({
        id: "security",
        label: "Security",
        icon: <Shield className="h-4 w-4" />,
        component: <SecuritySettings />,
        keywords: [
          "token",
          "auth",
          "session",
          "password",
          "api",
          "credentials",
        ],
        description: "Desktop security and local processing safeguards",
      });

      result.push({
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

      result.push({
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

    result.push({
      id: "openneuro",
      label: "OpenNeuro",
      icon: <Database className="h-4 w-4" />,
      component: <OpenNeuroSettings />,
      keywords: ["dataset", "download", "api", "key", "bids", "neuroimaging"],
      description: "Configure OpenNeuro API key for dataset access",
    });

    if (isTauriRuntime) {
      result.push({
        id: "debug",
        label: "Debug & Logs",
        icon: <FileText className="h-4 w-4" />,
        component: <DebugSettings />,
        keywords: ["logs", "diagnostics", "errors", "console", "troubleshoot"],
        description: "View application logs and debug information",
      });

      result.push({
        id: "updates",
        label: "Updates",
        icon: <Download className="h-4 w-4" />,
        component: <UpdatesSettings />,
        keywords: ["version", "upgrade", "new", "release", "check"],
        description: "Check for and install application updates",
      });
    }

    return result;
  }, [isTauriRuntime]);

  return <SettingsLayout sections={sections} defaultSection="general" />;
}
