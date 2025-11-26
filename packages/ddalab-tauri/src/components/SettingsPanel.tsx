"use client";

import { SettingsLayout, SettingsSection } from "./settings/SettingsLayout";
import { AnalysisEngineSettings } from "./settings/AnalysisEngineSettings";
import { BehaviorSettings } from "./settings/BehaviorSettings";
import { SecuritySettings } from "./settings/SecuritySettings";
import { NSGSettings } from "./settings/NSGSettings";
import { OpenNeuroSettings } from "./settings/OpenNeuroSettings";
import { DebugSettings } from "./settings/DebugSettings";
import { UpdatesSettings } from "./settings/UpdatesSettings";
import { TauriService } from "@/services/tauriService";
import {
  Activity,
  Cloud,
  FileText,
  Database,
  Shield,
  Download,
  Settings2,
} from "lucide-react";
import { useSearchableItems, createSettingsItem } from "@/hooks/useSearchable";

export function SettingsPanel() {
  // Register settings sections as searchable
  useSearchableItems(
    [
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
      id: "engine",
      label: "Analysis Engine",
      icon: <Activity className="h-4 w-4" />,
      component: <AnalysisEngineSettings />,
    },
  ];

  // Only add Behavior section in Tauri (close warning is Tauri-only)
  if (TauriService.isTauri()) {
    sections.push({
      id: "behavior",
      label: "Behavior",
      icon: <Settings2 className="h-4 w-4" />,
      component: <BehaviorSettings />,
    });
  }

  // Only add Security section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: "security",
      label: "Security",
      icon: <Shield className="h-4 w-4" />,
      component: <SecuritySettings />,
    });
  }

  // Only add NSG section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: "nsg",
      label: "NSG Integration",
      icon: <Cloud className="h-4 w-4" />,
      component: <NSGSettings />,
    });
  }

  // OpenNeuro section (available in both Tauri and web)
  sections.push({
    id: "openneuro",
    label: "OpenNeuro",
    icon: <Database className="h-4 w-4" />,
    component: <OpenNeuroSettings />,
  });

  // Only add Debug section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: "debug",
      label: "Debug & Logs",
      icon: <FileText className="h-4 w-4" />,
      component: <DebugSettings />,
    });
  }

  // Only add Updates section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: "updates",
      label: "Updates",
      icon: <Download className="h-4 w-4" />,
      component: <UpdatesSettings />,
    });
  }

  return <SettingsLayout sections={sections} defaultSection="engine" />;
}
