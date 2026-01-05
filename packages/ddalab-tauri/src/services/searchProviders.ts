import { SearchProvider, SearchResult } from "@/types/search";
import {
  getStateManager,
  isStateManagerRegistered,
} from "@/services/stateManager";
import {
  navigationConfig,
  secondaryTabConfig,
  PrimaryNavTab,
  SecondaryNavTab,
} from "@/types/navigation";
import { RegisteredItemsSearchProvider } from "./searchRegistry";
import { getQueryClient } from "@/providers/QueryProvider";
import { ddaKeys } from "@/hooks/useDDAAnalysis";
import { DDAResult } from "@/types/api";
import { useOpenFilesStore } from "@/store/openFilesStore";
import { useExportHistoryStore } from "@/store/exportHistoryStore";
import { useRecentFilesStore } from "@/store/recentFilesStore";
import { useNotificationStore } from "@/store/notificationStore";
import { useKeyboardShortcutsStore } from "@/store/keyboardShortcutsStore";

/**
 * Helper to safely get state manager.
 * Returns null if not registered (during SSR or early initialization).
 */
function getState() {
  if (!isStateManagerRegistered()) {
    return null;
  }
  return getStateManager();
}

export class NavigationSearchProvider implements SearchProvider {
  name = "Navigation";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    Object.values(navigationConfig).forEach((nav) => {
      const matchesLabel = nav.label.toLowerCase().includes(lowerQuery);
      const matchesDescription = nav.description
        .toLowerCase()
        .includes(lowerQuery);
      const matchesId = nav.id.toLowerCase().includes(lowerQuery);

      if (matchesLabel || matchesDescription || matchesId) {
        results.push({
          id: `nav-primary-${nav.id}`,
          type: "navigation",
          title: nav.label,
          description: nav.description,
          category: "Primary Navigation",
          icon: nav.icon,
          keywords: [nav.id, nav.label, nav.description],
          action: () => {
            getState()?.setPrimaryNav(nav.id as PrimaryNavTab);
          },
        });
      }

      if (nav.secondaryTabs) {
        nav.secondaryTabs.forEach((tabId) => {
          const tab = secondaryTabConfig[tabId];
          if (!tab || tab.enabled === false) return;

          const matchesTabLabel = tab.label.toLowerCase().includes(lowerQuery);
          const matchesTabDesc = tab.description
            ?.toLowerCase()
            .includes(lowerQuery);
          const matchesTabId = tab.id.toLowerCase().includes(lowerQuery);

          if (matchesTabLabel || matchesTabDesc || matchesTabId) {
            results.push({
              id: `nav-secondary-${tab.id}`,
              type: "navigation",
              title: tab.label,
              description: tab.description,
              subtitle: nav.label,
              category: "Secondary Navigation",
              icon: tab.icon,
              keywords: [tab.id, tab.label, tab.description || ""],
              action: () => {
                const state = getState();
                if (!state) return;
                state.setPrimaryNav(nav.id as PrimaryNavTab);
                state.setSecondaryNav(tabId as SecondaryNavTab);
              },
            });
          }
        });
      }
    });

    return results;
  }
}

export class SettingsSearchProvider implements SearchProvider {
  name = "Settings";

  private settingsSections = [
    {
      id: "engine",
      label: "Analysis Engine",
      description: "Configure analysis engine settings and performance",
      keywords: ["analysis", "engine", "performance", "computation"],
    },
    {
      id: "security",
      label: "Security",
      description: "Security settings and certificate management",
      keywords: ["security", "certificate", "ssl", "https", "encryption"],
    },
    {
      id: "nsg",
      label: "NSG Integration",
      description: "Neuroscience Gateway integration settings",
      keywords: ["nsg", "gateway", "cloud", "computing", "hpc"],
    },
    {
      id: "openneuro",
      label: "OpenNeuro",
      description: "OpenNeuro and NEMAR data repository settings",
      keywords: ["openneuro", "nemar", "data", "repository", "dataset"],
    },
    {
      id: "debug",
      label: "Debug & Logs",
      description: "Debug settings and application logs",
      keywords: ["debug", "logs", "diagnostics", "troubleshooting"],
    },
    {
      id: "updates",
      label: "Updates",
      description: "Application updates and version information",
      keywords: ["updates", "version", "upgrade", "changelog"],
    },
  ];

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    this.settingsSections.forEach((section) => {
      const matchesLabel = section.label.toLowerCase().includes(lowerQuery);
      const matchesDescription = section.description
        .toLowerCase()
        .includes(lowerQuery);
      const matchesKeywords = section.keywords.some((kw) =>
        kw.toLowerCase().includes(lowerQuery),
      );
      const matchesId = section.id.toLowerCase().includes(lowerQuery);

      if (matchesLabel || matchesDescription || matchesKeywords || matchesId) {
        results.push({
          id: `settings-${section.id}`,
          type: "settings",
          title: section.label,
          description: section.description,
          category: "Settings",
          icon: "Settings",
          keywords: section.keywords,
          action: () => {
            getState()?.setPrimaryNav("settings");
            setTimeout(() => {
              const element = document.getElementById(
                `settings-section-${section.id}`,
              );
              if (element) {
                element.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }, 100);
          },
        });
      }
    });

    return results;
  }
}

export class FileSearchProvider implements SearchProvider {
  name = "Files";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    const state = getState();
    if (!state) return results;
    const selectedFile = state.getSelectedFile();

    if (selectedFile) {
      const matchesFileName = selectedFile.file_name
        .toLowerCase()
        .includes(lowerQuery);
      const matchesPath = selectedFile.file_path
        .toLowerCase()
        .includes(lowerQuery);

      if (matchesFileName || matchesPath) {
        results.push({
          id: `file-${selectedFile.file_path}`,
          type: "file",
          title: selectedFile.file_name,
          subtitle: selectedFile.file_path,
          description: `${selectedFile.channels.length} channels, ${selectedFile.duration.toFixed(2)}s`,
          category: "Current File",
          icon: "File",
          keywords: [selectedFile.file_name, selectedFile.file_path],
          action: () => {
            getState()?.setPrimaryNav("explore");
            getState()?.setSecondaryNav("timeseries");
          },
        });
      }
    }

    return results;
  }
}

export class ChannelSearchProvider implements SearchProvider {
  name = "Channels";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    const state = getState();
    if (!state) return results;
    const selectedFile = state.getSelectedFile();

    if (selectedFile?.channels) {
      selectedFile.channels.forEach((channel, index) => {
        if (channel.toLowerCase().includes(lowerQuery)) {
          results.push({
            id: `channel-${index}-${channel}`,
            type: "channel",
            title: channel,
            subtitle: selectedFile.file_name,
            description: `Channel from current file`,
            category: "Channels",
            icon: "Radio",
            keywords: [channel],
            action: () => {
              const state = getState();
              if (!state) return;
              state.setPrimaryNav("explore");
              state.setSecondaryNav("timeseries");
              const currentChannels = state.getSelectedChannels();
              if (!currentChannels.includes(channel)) {
                state.setSelectedChannels([...currentChannels, channel]);
              }
            },
          });
        }
      });
    }

    return results;
  }
}

export class AnalysisSearchProvider implements SearchProvider {
  name = "Analysis";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    const state = getState();
    if (!state) return results;

    // Try Zustand store first, then fall back to TanStack Query cache
    let analysisHistory = state.getAnalysisHistory();
    if (analysisHistory.length === 0) {
      // Try to get from TanStack Query cache
      const queryClient = getQueryClient();
      if (queryClient) {
        const cachedHistory = queryClient.getQueryData<DDAResult[]>(
          ddaKeys.history(),
        );
        if (cachedHistory && cachedHistory.length > 0) {
          analysisHistory = cachedHistory;
        }
      }
    }

    analysisHistory.forEach((analysis) => {
      const matchesId = analysis.id.toLowerCase().includes(lowerQuery);
      const matchesFile = analysis.file_path
        ?.toLowerCase()
        .includes(lowerQuery);
      const matchesName = analysis.name?.toLowerCase().includes(lowerQuery);
      const matchesChannels = analysis.channels?.some((ch) =>
        ch.toLowerCase().includes(lowerQuery),
      );
      const variants =
        analysis.results?.variants?.map((v) => v.variant_name) || [];
      const matchesVariant = variants.some((v) =>
        v.toLowerCase().includes(lowerQuery),
      );

      if (
        matchesId ||
        matchesFile ||
        matchesName ||
        matchesChannels ||
        matchesVariant
      ) {
        const date = analysis.created_at
          ? new Date(analysis.created_at).toLocaleString()
          : "Unknown date";
        const fileName =
          analysis.file_path.split("/").pop() || analysis.file_path;
        const variantLabel = variants.length > 0 ? variants.join(", ") : "DDA";

        results.push({
          id: `analysis-${analysis.id}`,
          type: "analysis",
          title: analysis.name || `${variantLabel} Analysis`,
          subtitle: fileName,
          description: `${analysis.channels?.join(", ") || "No channels"} - ${date}`,
          category: "Analysis Results",
          icon: "Brain",
          keywords: [
            analysis.id,
            ...variants,
            ...(analysis.channels || []),
            fileName,
            analysis.name || "",
          ],
          metadata: { analysis },
          action: () => {
            // Set pending analysis ID - DDAWithHistory will fetch the full data
            getState()?.setPendingAnalysisId(analysis.id);
            getState()?.setPrimaryNav("analyze");
          },
        });
      }
    });

    return results;
  }
}

export class ActionSearchProvider implements SearchProvider {
  name = "Actions";

  private actions = [
    {
      id: "run-dda",
      title: "Run DDA Analysis",
      description: "Start a new Delay Differential Analysis",
      keywords: ["run", "start", "dda", "analysis", "analyze"],
      icon: "Play",
      action: () => {
        getState()?.setPrimaryNav("analyze");
      },
    },
    {
      id: "open-file",
      title: "Open File",
      description: "Browse and open a data file",
      keywords: ["open", "file", "browse", "load"],
      icon: "FolderOpen",
      action: () => {
        getState()?.setPrimaryNav("explore");
        getState()?.setSidebarOpen(true);
      },
    },
    {
      id: "view-notifications",
      title: "View Notifications",
      description: "See all system notifications",
      keywords: ["notifications", "alerts", "messages"],
      icon: "Bell",
      action: () => {
        getState()?.setPrimaryNav("notifications");
      },
    },
    {
      id: "toggle-theme",
      title: "Toggle Theme",
      description: "Switch between light and dark mode",
      keywords: ["theme", "dark", "light", "mode", "appearance"],
      icon: "Palette",
      action: () => {
        const state = getState();
        if (!state) return;
        const currentTheme = state.getTheme();
        const newTheme = currentTheme === "dark" ? "light" : "dark";
        state.setTheme(newTheme);
      },
    },
    {
      id: "toggle-sidebar",
      title: "Toggle Sidebar",
      description: "Show or hide the file manager sidebar",
      keywords: ["sidebar", "file manager", "toggle", "hide", "show"],
      icon: "PanelLeft",
      action: () => {
        const state = getState();
        if (!state) return;
        const isOpen = state.getSidebarOpen();
        state.setSidebarOpen(!isOpen);
      },
    },
  ];

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    this.actions.forEach((action) => {
      const matchesTitle = action.title.toLowerCase().includes(lowerQuery);
      const matchesDescription = action.description
        .toLowerCase()
        .includes(lowerQuery);
      const matchesKeywords = action.keywords.some((kw) =>
        kw.toLowerCase().includes(lowerQuery),
      );
      const matchesId = action.id.toLowerCase().includes(lowerQuery);

      if (matchesTitle || matchesDescription || matchesKeywords || matchesId) {
        results.push({
          id: `action-${action.id}`,
          type: "action",
          title: action.title,
          description: action.description,
          category: "Actions",
          icon: action.icon,
          keywords: action.keywords,
          action: action.action,
        });
      }
    });

    return results;
  }
}

// === File & Data Management ===

export class FileHistorySearchProvider implements SearchProvider {
  name = "FileHistory";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    const state = getState();
    if (!state) return results;

    // Search through analysis history to find all unique files
    const fileMap = new Map<
      string,
      { name: string; path: string; lastUsed: string }
    >();

    state.getAnalysisHistory().forEach((analysis) => {
      const fileName =
        analysis.file_path.split("/").pop() || analysis.file_path;
      const matchesName = fileName.toLowerCase().includes(lowerQuery);
      const matchesPath = analysis.file_path.toLowerCase().includes(lowerQuery);

      if ((matchesName || matchesPath) && !fileMap.has(analysis.file_path)) {
        fileMap.set(analysis.file_path, {
          name: fileName,
          path: analysis.file_path,
          lastUsed: analysis.created_at,
        });
      }
    });

    fileMap.forEach((file, path) => {
      results.push({
        id: `file-history-${path}`,
        type: "file",
        title: file.name,
        subtitle: file.path,
        description: `Last used: ${new Date(file.lastUsed).toLocaleString()}`,
        category: "File History",
        icon: "File",
        keywords: [file.name, file.path, "history"],
        action: () => {
          // Navigate to explore tab - user can load this file
          getState()?.setPrimaryNav("explore");
        },
      });
    });

    return results;
  }
}

export class FileMetadataSearchProvider implements SearchProvider {
  name = "FileMetadata";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    const state = getState();
    if (!state) return results;

    // Search current file metadata
    const selectedFile = state.getSelectedFile();
    if (!selectedFile) return results;

    // Infer format from file extension
    const extension =
      selectedFile.file_path.split(".").pop()?.toUpperCase() || "";
    const format = extension || "Unknown format";

    const metadata = [
      `${selectedFile.channels.length} channels`,
      `${selectedFile.sample_rate} Hz`,
      `${selectedFile.duration.toFixed(2)}s duration`,
      format,
    ];

    const searchableText = metadata.join(" ").toLowerCase();
    if (searchableText.includes(lowerQuery)) {
      results.push({
        id: `file-metadata-${selectedFile.file_path}`,
        type: "file",
        title: selectedFile.file_name,
        subtitle: metadata.join(" • "),
        description: `Format: ${format}`,
        category: "File Metadata",
        icon: "File",
        keywords: metadata,
        action: () => {
          getState()?.setPrimaryNav("explore");
          getState()?.setSecondaryNav("timeseries");
        },
      });
    }

    return results;
  }
}

export class FileFormatSearchProvider implements SearchProvider {
  name = "FileFormat";

  private formats = [
    {
      type: "EDF",
      description: "European Data Format",
      keywords: ["edf", "edf+", "european"],
    },
    {
      type: "ASCII",
      description: "Plain text data",
      keywords: ["ascii", "text", "csv", "txt"],
    },
    {
      type: "XDF",
      description: "Extensible Data Format (LSL)",
      keywords: ["xdf", "lsl", "lab streaming"],
    },
    {
      type: "NWB",
      description: "Neurodata Without Borders",
      keywords: ["nwb", "hdf5", "neurodata"],
    },
    {
      type: "BrainVision",
      description: "BrainProducts format",
      keywords: ["vhdr", "vmrk", "brainvision"],
    },
    {
      type: "EEGLAB",
      description: "MATLAB EEGLAB format",
      keywords: ["set", "fdt", "eeglab", "matlab"],
    },
    {
      type: "FIF",
      description: "Neuromag/Elekta MEG format",
      keywords: ["fif", "fiff", "neuromag", "elekta", "meg"],
    },
    {
      type: "NIfTI",
      description: "Neuroimaging format",
      keywords: ["nii", "nifti", "neuroimaging"],
    },
  ];

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    this.formats.forEach((format) => {
      const matchesType = format.type.toLowerCase().includes(lowerQuery);
      const matchesDescription = format.description
        .toLowerCase()
        .includes(lowerQuery);
      const matchesKeywords = format.keywords.some((kw) =>
        kw.includes(lowerQuery),
      );

      if (matchesType || matchesDescription || matchesKeywords) {
        results.push({
          id: `format-${format.type}`,
          type: "file",
          title: format.type,
          description: format.description,
          category: "File Formats",
          icon: "File",
          keywords: format.keywords,
          action: () => {
            // Navigate to file manager
            getState()?.setPrimaryNav("explore");
          },
        });
      }
    });

    return results;
  }
}

// === Analysis & Results ===

export class DDAVariantSearchProvider implements SearchProvider {
  name = "DDAVariant";

  private variants = [
    {
      name: "ST-DDA",
      description: "Single-Timeseries delay differential analysis",
      keywords: ["st", "single", "time"],
    },
    {
      name: "CT-DDA",
      description: "Cross-Timeseries delay differential analysis",
      keywords: ["ct", "cross", "time"],
    },
    {
      name: "CD-DDA",
      description: "Cross-Dynamical delay differential analysis",
      keywords: ["cd", "cross", "dynamical"],
    },
    {
      name: "DE-DDA",
      description: "Dynamical Ergodicity delay differential analysis",
      keywords: ["de", "dynamical", "ergodicity"],
    },
    {
      name: "SY-DDA",
      description: "Synchronization delay differential analysis",
      keywords: ["sy", "synchrony", "sync"],
    },
    {
      name: "SELECT-DDA",
      description: "Model selection analysis",
      keywords: ["select", "selection", "model"],
    },
  ];

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    this.variants.forEach((variant) => {
      const matchesName = variant.name.toLowerCase().includes(lowerQuery);
      const matchesDescription = variant.description
        .toLowerCase()
        .includes(lowerQuery);
      const matchesKeywords = variant.keywords.some((kw) =>
        kw.includes(lowerQuery),
      );

      if (matchesName || matchesDescription || matchesKeywords) {
        results.push({
          id: `variant-${variant.name}`,
          type: "analysis",
          title: variant.name,
          description: variant.description,
          category: "DDA Variants",
          icon: "Brain",
          keywords: variant.keywords,
          action: () => {
            getState()?.setPrimaryNav("analyze");
          },
        });
      }
    });

    return results;
  }
}

export class AnalysisParametersSearchProvider implements SearchProvider {
  name = "AnalysisParameters";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    const state = getState();
    if (!state) return results;
    const params = state.getAnalysisParameters();

    const paramDescriptions = [
      {
        key: "window length",
        value: `${params.windowLength}s`,
        keywords: ["window", "length", "time"],
      },
      {
        key: "window step",
        value: `${params.windowStep}s`,
        keywords: ["step", "stride", "hop"],
      },
      {
        key: "delays",
        value: params.delays ? `[${params.delays.join(", ")}]` : "default",
        keywords: ["delays", "scale", "tau", "range"],
      },
      {
        key: "variants",
        value: params.variants.join(", "),
        keywords: ["variant", "type", "model"],
      },
    ];

    paramDescriptions.forEach((param) => {
      const matchesKey = param.key.includes(lowerQuery);
      const matchesValue = param.value.toLowerCase().includes(lowerQuery);
      const matchesKeywords = param.keywords.some((kw) =>
        kw.includes(lowerQuery),
      );

      if (matchesKey || matchesValue || matchesKeywords) {
        results.push({
          id: `param-${param.key}`,
          type: "action",
          title: param.key.charAt(0).toUpperCase() + param.key.slice(1),
          subtitle: param.value,
          description: "Current analysis parameter",
          category: "Analysis Parameters",
          icon: "Settings",
          keywords: param.keywords,
          action: () => {
            getState()?.setPrimaryNav("analyze");
          },
        });
      }
    });

    return results;
  }
}

export class DelayPresetSearchProvider implements SearchProvider {
  name = "DelayPreset";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    const state = getState();
    if (!state) return results;

    state.getCustomDelayPresets().forEach((preset) => {
      const matchesName = preset.name.toLowerCase().includes(lowerQuery);
      const matchesDescription = preset.description
        .toLowerCase()
        .includes(lowerQuery);
      const matchesDelays = preset.delays.some((d) =>
        d.toString().includes(lowerQuery),
      );

      if (matchesName || matchesDescription || matchesDelays) {
        results.push({
          id: `preset-${preset.id}`,
          type: "action",
          title: preset.name,
          subtitle: `Delays: ${preset.delays.join(", ")}`,
          description: preset.description,
          category: preset.isBuiltIn ? "Built-in Presets" : "Custom Presets",
          icon: "Brain",
          keywords: [preset.name, ...preset.delays.map((d) => d.toString())],
          action: () => {
            getState()?.setPrimaryNav("analyze");
          },
        });
      }
    });

    return results;
  }
}

export class AnalysisStatusSearchProvider implements SearchProvider {
  name = "AnalysisStatus";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    const state = getState();
    if (!state) return results;

    const statusKeywords = {
      pending: ["pending", "queued", "waiting"],
      running: ["running", "processing", "active", "in progress"],
      completed: ["completed", "finished", "done", "success"],
      failed: ["failed", "error", "failed"],
    };

    state.getAnalysisHistory().forEach((analysis) => {
      const status = analysis.status;
      const keywords = statusKeywords[status] || [];
      const matchesStatus = keywords.some((kw) => kw.includes(lowerQuery));
      const matchesFile = analysis.file_path.toLowerCase().includes(lowerQuery);

      if (matchesStatus || (matchesFile && status !== "completed")) {
        const fileName =
          analysis.file_path.split("/").pop() || analysis.file_path;
        results.push({
          id: `status-${analysis.id}`,
          type: "analysis",
          title: `${status.toUpperCase()} Analysis`,
          subtitle: fileName,
          description: `Status: ${status} - ${new Date(analysis.created_at).toLocaleString()}`,
          category: "Analysis Status",
          icon: "Brain",
          keywords: [...keywords, fileName],
          action: () => {
            getState()?.setCurrentAnalysis(analysis);
            getState()?.setPrimaryNav("analyze");
          },
        });
      }
    });

    return results;
  }
}

// === Streaming & Real-time ===

export class StreamSessionSearchProvider implements SearchProvider {
  name = "StreamSession";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    const state = getState();
    if (!state) return results;

    Object.entries(state.getSessions()).forEach(([sessionId, session]) => {
      const matchesId = sessionId.toLowerCase().includes(lowerQuery);
      const sourceType = session.source_config.type;
      const matchesSource = sourceType.toLowerCase().includes(lowerQuery);
      const status = session.state.type;
      const matchesStatus = status.toLowerCase().includes(lowerQuery);

      if (matchesId || matchesSource || matchesStatus) {
        results.push({
          id: `stream-${sessionId}`,
          type: "action",
          title: `Stream: ${sessionId.substring(0, 8)}`,
          subtitle: `${sourceType} - ${status}`,
          description: `Chunks received: ${session.stats.chunks_received}`,
          category: "Stream Sessions",
          icon: "Radio",
          keywords: [sourceType, status, "stream"],
          action: () => {
            getState()?.setPrimaryNav("explore");
            getState()?.setSecondaryNav("streaming");
          },
        });
      }
    });

    return results;
  }
}

// === Annotations & Events ===

export class AnnotationSearchProvider implements SearchProvider {
  name = "Annotation";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    const state = getState();
    if (!state) return results;

    // Search time series annotations
    Object.entries(state.getTimeSeriesAnnotations()).forEach(
      ([fileId, annotations]) => {
        // Defensive check: ensure annotations exist
        if (!annotations) {
          return;
        }

        // Search global annotations
        if (
          annotations.globalAnnotations &&
          Array.isArray(annotations.globalAnnotations)
        ) {
          annotations.globalAnnotations.forEach((annotation, index) => {
            const matchesLabel = annotation.label
              ?.toLowerCase()
              .includes(lowerQuery);
            const matchesPosition = annotation.position
              .toString()
              .includes(lowerQuery);

            if (matchesLabel || matchesPosition) {
              results.push({
                id: `annotation-ts-${fileId}-global-${index}`,
                type: "action",
                title:
                  annotation.label || `Annotation at ${annotation.position}`,
                subtitle: `Position: ${annotation.position}`,
                description: annotation.description || "Time series annotation",
                category: "Annotations",
                icon: "Bell",
                keywords: [annotation.label || "", "annotation", "global"],
                action: () => {
                  getState()?.setPrimaryNav("explore");
                  getState()?.setSecondaryNav("timeseries");
                },
              });
            }
          });
        }

        // Search channel-specific annotations
        if (annotations.channelAnnotations) {
          Object.entries(annotations.channelAnnotations).forEach(
            ([channel, channelAnns]) => {
              if (Array.isArray(channelAnns)) {
                channelAnns.forEach((annotation, index) => {
                  const matchesLabel = annotation.label
                    ?.toLowerCase()
                    .includes(lowerQuery);
                  const matchesPosition = annotation.position
                    .toString()
                    .includes(lowerQuery);
                  const matchesChannel = channel
                    .toLowerCase()
                    .includes(lowerQuery);

                  if (matchesLabel || matchesPosition || matchesChannel) {
                    results.push({
                      id: `annotation-ts-${fileId}-${channel}-${index}`,
                      type: "action",
                      title:
                        annotation.label ||
                        `Annotation at ${annotation.position}`,
                      subtitle: `Channel: ${channel} | Position: ${annotation.position}`,
                      description:
                        annotation.description || "Channel annotation",
                      category: "Annotations",
                      icon: "Bell",
                      keywords: [annotation.label || "", "annotation", channel],
                      action: () => {
                        getState()?.setPrimaryNav("explore");
                        getState()?.setSecondaryNav("timeseries");
                      },
                    });
                  }
                });
              }
            },
          );
        }
      },
    );

    return results;
  }
}

// === NSG (Neuroscience Gateway) Jobs ===

export class NSGJobSearchProvider implements SearchProvider {
  name = "NSGJobs";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    // NSG navigation keywords
    const nsgKeywords = [
      "nsg",
      "gateway",
      "neuroscience",
      "hpc",
      "high performance",
      "computing",
      "cluster",
      "job",
      "submit",
    ];

    const matchesNSG = nsgKeywords.some((kw) => kw.includes(lowerQuery));

    if (matchesNSG) {
      results.push({
        id: "nav-nsg-jobs",
        type: "navigation",
        title: "NSG Job Manager",
        description: "View and manage Neuroscience Gateway jobs",
        category: "NSG",
        icon: "Cloud",
        keywords: nsgKeywords,
        action: () => {
          getState()?.setPrimaryNav("data");
          getState()?.setSecondaryNav("nsg-jobs");
        },
      });

      results.push({
        id: "action-submit-nsg",
        type: "action",
        title: "Submit NSG Job",
        subtitle: "Cloud Computing",
        description: "Submit a new job to the Neuroscience Gateway",
        category: "NSG",
        icon: "Upload",
        keywords: ["submit", "upload", "nsg", "job", "hpc"],
        action: () => {
          getState()?.setPrimaryNav("data");
          getState()?.setSecondaryNav("nsg-jobs");
        },
      });
    }

    return results;
  }
}

// === ICA Analysis ===

export class ICASearchProvider implements SearchProvider {
  name = "ICA";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    const icaKeywords = [
      "ica",
      "independent component",
      "component analysis",
      "artifact",
      "decomposition",
      "fastica",
      "source separation",
    ];

    const matchesICA = icaKeywords.some((kw) => kw.includes(lowerQuery));

    if (matchesICA) {
      results.push({
        id: "nav-ica-analysis",
        type: "navigation",
        title: "ICA Analysis",
        description: "Independent Component Analysis for artifact removal",
        category: "Analysis",
        icon: "Brain",
        keywords: icaKeywords,
        action: () => {
          getState()?.setPrimaryNav("analyze");
          getState()?.setSecondaryNav("ica");
        },
      });

      results.push({
        id: "action-run-ica",
        type: "action",
        title: "Run ICA",
        description: "Start Independent Component Analysis on current file",
        category: "Actions",
        icon: "Play",
        keywords: ["run", "start", ...icaKeywords],
        action: () => {
          getState()?.setPrimaryNav("analyze");
          getState()?.setSecondaryNav("ica");
        },
      });
    }

    return results;
  }
}

// === Data Sources (OpenNeuro, BIDS) ===

export class DataSourceSearchProvider implements SearchProvider {
  name = "DataSources";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    // OpenNeuro
    if (
      "openneuro".includes(lowerQuery) ||
      "nemar".includes(lowerQuery) ||
      "dataset".includes(lowerQuery) ||
      "download".includes(lowerQuery)
    ) {
      results.push({
        id: "nav-openneuro",
        type: "navigation",
        title: "OpenNeuro Browser",
        description: "Browse and download public EEG datasets from OpenNeuro",
        category: "Data Sources",
        icon: "FolderOpen",
        keywords: [
          "openneuro",
          "nemar",
          "dataset",
          "download",
          "public",
          "eeg",
        ],
        action: () => {
          getState()?.setPrimaryNav("data");
          getState()?.setSecondaryNav("openneuro");
        },
      });
    }

    // BIDS - navigates to data tab
    if ("bids".includes(lowerQuery) || "brain imaging".includes(lowerQuery)) {
      results.push({
        id: "nav-bids",
        type: "navigation",
        title: "BIDS Browser",
        description: "Browse BIDS-formatted datasets",
        category: "Data Sources",
        icon: "FolderOpen",
        keywords: ["bids", "brain imaging", "dataset", "structure"],
        action: () => {
          getState()?.setPrimaryNav("data");
          getState()?.setSecondaryNav("openneuro");
        },
      });
    }

    return results;
  }
}

// === Quick Actions ===

export class QuickActionsSearchProvider implements SearchProvider {
  name = "QuickActions";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    const quickActions = [
      {
        id: "export-results",
        title: "Export Results",
        description: "Export analysis results to CSV or JSON",
        keywords: ["export", "save", "download", "results", "csv", "json"],
        action: () => {
          getState()?.setPrimaryNav("analyze");
        },
      },
      {
        id: "export-plot",
        title: "Export Plot",
        description: "Export current plot as PNG, SVG, or PDF",
        keywords: ["export", "plot", "image", "png", "svg", "pdf", "figure"],
        action: () => {
          getState()?.setPrimaryNav("analyze");
        },
      },
      {
        id: "clear-cache",
        title: "Clear Cache",
        description: "Clear application cache and temporary data",
        keywords: ["clear", "cache", "reset", "clean", "temporary"],
        action: () => {
          getState()?.setPrimaryNav("settings");
        },
      },
      {
        id: "view-logs",
        title: "View Application Logs",
        description: "Open debug logs and diagnostics",
        keywords: ["logs", "debug", "diagnostics", "errors", "troubleshoot"],
        action: () => {
          getState()?.setPrimaryNav("settings");
        },
      },
      {
        id: "check-updates",
        title: "Check for Updates",
        description: "Check if a newer version of DDALAB is available",
        keywords: ["update", "upgrade", "version", "new", "latest"],
        action: () => {
          getState()?.setPrimaryNav("settings");
        },
      },
      {
        id: "network-motifs",
        title: "Network Motifs",
        description: "View network motif analysis from DDA results",
        keywords: ["network", "motifs", "graph", "connectivity", "patterns"],
        action: () => {
          getState()?.setPrimaryNav("analyze");
        },
      },
      {
        id: "time-series-view",
        title: "Time Series Viewer",
        description: "View and explore time series data from current file",
        keywords: ["time", "series", "view", "plot", "signal", "waveform"],
        action: () => {
          getState()?.setPrimaryNav("explore");
          getState()?.setSecondaryNav("timeseries");
        },
      },
      {
        id: "channel-selection",
        title: "Select Channels",
        description: "Choose which channels to analyze",
        keywords: ["channel", "select", "electrode", "choose"],
        action: () => {
          getState()?.setPrimaryNav("analyze");
        },
      },
    ];

    quickActions.forEach((action) => {
      const matchesTitle = action.title.toLowerCase().includes(lowerQuery);
      const matchesDescription = action.description
        .toLowerCase()
        .includes(lowerQuery);
      const matchesKeywords = action.keywords.some((kw) =>
        kw.includes(lowerQuery),
      );

      if (matchesTitle || matchesDescription || matchesKeywords) {
        results.push({
          id: `quick-${action.id}`,
          type: "action",
          title: action.title,
          description: action.description,
          category: "Quick Actions",
          icon: "Play",
          keywords: action.keywords,
          action: action.action,
        });
      }
    });

    return results;
  }
}

// === Help & Documentation ===

export class HelpSearchProvider implements SearchProvider {
  name = "Help";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    const helpTopics = [
      {
        id: "help-dda",
        title: "What is DDA?",
        description: "Learn about Delay Differential Analysis",
        keywords: [
          "help",
          "dda",
          "what",
          "learn",
          "about",
          "delay differential",
        ],
      },
      {
        id: "help-variants",
        title: "DDA Variants Explained",
        description: "Understand ST-DDA, CT-DDA, CD-DDA, and other variants",
        keywords: [
          "help",
          "variant",
          "st",
          "ct",
          "cd",
          "de",
          "sy",
          "explained",
        ],
      },
      {
        id: "help-parameters",
        title: "Parameter Selection Guide",
        description:
          "How to choose window length, scale range, and other parameters",
        keywords: ["help", "parameter", "window", "scale", "guide", "choose"],
      },
      {
        id: "help-interpretation",
        title: "Interpreting Results",
        description: "How to interpret DDA matrices and exponents",
        keywords: [
          "help",
          "interpret",
          "results",
          "matrix",
          "exponent",
          "understand",
        ],
      },
      {
        id: "help-file-formats",
        title: "Supported File Formats",
        description: "EDF, BrainVision, XDF, and other supported formats",
        keywords: ["help", "format", "edf", "file", "support", "import"],
      },
    ];

    helpTopics.forEach((topic) => {
      const matchesTitle = topic.title.toLowerCase().includes(lowerQuery);
      const matchesDescription = topic.description
        .toLowerCase()
        .includes(lowerQuery);
      const matchesKeywords = topic.keywords.some((kw) =>
        kw.includes(lowerQuery),
      );

      if (matchesTitle || matchesDescription || matchesKeywords) {
        results.push({
          id: topic.id,
          type: "action",
          title: topic.title,
          description: topic.description,
          category: "Help & Documentation",
          icon: "Home",
          keywords: topic.keywords,
          action: () => {
            // TODO: Open help modal or navigate to docs for topic: ${topic.id}
          },
        });
      }
    });

    return results;
  }
}

// ============================================================================
// NEW SEARCH PROVIDERS
// ============================================================================

export class OpenFileTabsSearchProvider implements SearchProvider {
  name = "OpenFileTabs";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    const openFiles = useOpenFilesStore.getState().files;
    const activeFilePath = useOpenFilesStore.getState().activeFilePath;

    openFiles.forEach((file) => {
      const matchesName = file.fileName.toLowerCase().includes(lowerQuery);
      const matchesPath = file.filePath.toLowerCase().includes(lowerQuery);

      if (matchesName || matchesPath || lowerQuery === "") {
        const isPinned = file.isPinned;
        const isActive = file.filePath === activeFilePath;
        const subtitle = isPinned ? "📌 Pinned" : "Open tab";

        results.push({
          id: `open-tab-${file.filePath}`,
          type: "file",
          title: file.fileName,
          subtitle,
          description: file.filePath,
          category: isActive ? "Active Tab" : "Open Tabs",
          icon: "File",
          keywords: [
            file.fileName,
            file.filePath,
            isPinned ? "pinned" : "",
            "tab",
          ],
          metadata: {
            isPinned: file.isPinned,
            lastActiveAt: file.lastActiveAt,
            isActive,
          },
          action: async () => {
            if (file.filePath !== activeFilePath) {
              useOpenFilesStore.getState().setActiveFile(file.filePath);
            }
            getState()?.setPrimaryNav("explore");
            getState()?.setSecondaryNav("timeseries");
          },
        });
      }
    });

    return results.sort((a, b) => {
      if (a.metadata?.isActive) return -1;
      if (b.metadata?.isActive) return 1;
      if (a.metadata?.isPinned && !b.metadata?.isPinned) return -1;
      if (!a.metadata?.isPinned && b.metadata?.isPinned) return 1;
      return (
        new Date(b.metadata?.lastActiveAt || 0).getTime() -
        new Date(a.metadata?.lastActiveAt || 0).getTime()
      );
    });
  }
}

export class BookmarksSearchProvider implements SearchProvider {
  name = "Bookmarks";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    const favorites = useRecentFilesStore.getState().favorites;

    favorites.forEach((favorite) => {
      const matchesName = favorite.name.toLowerCase().includes(lowerQuery);
      const matchesPath = favorite.path.toLowerCase().includes(lowerQuery);
      const matchesType = favorite.type.toLowerCase().includes(lowerQuery);

      if (
        matchesName ||
        matchesPath ||
        matchesType ||
        "favorite".includes(lowerQuery) ||
        "bookmark".includes(lowerQuery) ||
        lowerQuery === ""
      ) {
        results.push({
          id: `favorite-${favorite.path}`,
          type: "file",
          title: `⭐ ${favorite.name}`,
          subtitle: favorite.type.toUpperCase(),
          description: favorite.path,
          category: "Favorites",
          icon: "Star",
          keywords: [
            favorite.name,
            favorite.path,
            favorite.type,
            "favorite",
            "starred",
            "bookmark",
          ],
          metadata: { favorite },
          action: async () => {
            await useOpenFilesStore.getState().openFile(favorite.path);
            getState()?.setPrimaryNav("explore");
          },
        });
      }
    });

    return results.sort((a, b) => {
      const aFav = a.metadata?.favorite;
      const bFav = b.metadata?.favorite;
      return (bFav?.addedAt || 0) - (aFav?.addedAt || 0);
    });
  }
}

export class DashboardWidgetsSearchProvider implements SearchProvider {
  name = "DashboardWidgets";

  private widgetTypes = [
    {
      id: "timeseries-widget",
      name: "Time Series Chart",
      description: "View multichannel time series data",
      category: "Visualization",
      keywords: ["plot", "chart", "timeseries", "signal", "waveform"],
    },
    {
      id: "spectrogram-widget",
      name: "Spectrogram",
      description: "Frequency analysis over time",
      category: "Visualization",
      keywords: ["frequency", "spectrogram", "fft", "power"],
    },
    {
      id: "dda-matrix-widget",
      name: "DDA Matrix",
      description: "Delay differential analysis heatmap",
      category: "Analysis",
      keywords: ["dda", "matrix", "heatmap", "analysis"],
    },
    {
      id: "metrics-widget",
      name: "Analysis Metrics",
      description: "Key metrics and statistics",
      category: "Analysis",
      keywords: ["metrics", "stats", "statistics", "summary"],
    },
    {
      id: "channel-selector-widget",
      name: "Channel Selector",
      description: "Select and manage channels",
      category: "Controls",
      keywords: ["channel", "select", "electrode"],
    },
  ];

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    this.widgetTypes.forEach((widget) => {
      const matchesName = widget.name.toLowerCase().includes(lowerQuery);
      const matchesDescription = widget.description
        .toLowerCase()
        .includes(lowerQuery);
      const matchesKeywords = widget.keywords.some((kw) =>
        kw.includes(lowerQuery),
      );

      if (matchesName || matchesDescription || matchesKeywords) {
        results.push({
          id: `widget-${widget.id}`,
          type: "action",
          title: widget.name,
          description: widget.description,
          category: `Widgets - ${widget.category}`,
          icon: "Layout",
          keywords: widget.keywords,
          action: () => {
            const state = getState();
            if (widget.id.includes("dda")) {
              state?.setPrimaryNav("analyze");
            } else {
              state?.setPrimaryNav("explore");
              state?.setSecondaryNav("timeseries");
            }
          },
        });
      }
    });

    return results;
  }
}

export class AnalysisPresetsSearchProvider implements SearchProvider {
  name = "AnalysisPresets";

  private builtInTemplates = [
    {
      id: "fast-screening",
      name: "Fast Screening",
      description: "Quick analysis with shorter windows for rapid exploration",
      parameters: {
        variants: ["single_timeseries"],
        windowLength: 32,
        windowStep: 5,
        delays: [5, 7, 10],
      },
    },
    {
      id: "detailed-analysis",
      name: "Detailed Analysis",
      description: "Comprehensive analysis with longer windows",
      parameters: {
        variants: ["single_timeseries", "cross_timeseries"],
        windowLength: 128,
        windowStep: 20,
        delays: [7, 10, 15, 20],
      },
    },
    {
      id: "multi-variant",
      name: "Multi-Variant Suite",
      description: "Run all DDA variants for complete characterization",
      parameters: {
        variants: [
          "single_timeseries",
          "cross_timeseries",
          "cross_dynamical",
          "synchronization",
        ],
        windowLength: 64,
        windowStep: 10,
        delays: [7, 10, 15],
      },
    },
  ];

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    const state = getState();
    if (!state) return results;

    const delayPresets = state.getCustomDelayPresets();
    delayPresets.forEach((preset) => {
      const matchesName = preset.name.toLowerCase().includes(lowerQuery);
      const matchesDescription = preset.description
        .toLowerCase()
        .includes(lowerQuery);
      const matchesDelays = preset.delays.some((d) =>
        d.toString().includes(lowerQuery),
      );

      if (
        matchesName ||
        matchesDescription ||
        matchesDelays ||
        "preset".includes(lowerQuery)
      ) {
        results.push({
          id: `delay-preset-${preset.id}`,
          type: "action",
          title: preset.name,
          subtitle: `Delays: [${preset.delays.join(", ")}]`,
          description: preset.description,
          category: preset.isBuiltIn
            ? "Built-in Delay Presets"
            : "Custom Delay Presets",
          icon: "Brain",
          keywords: [
            preset.name,
            "delays",
            "preset",
            ...preset.delays.map((d) => d.toString()),
          ],
          metadata: { preset },
          action: () => {
            state.setPrimaryNav("analyze");
          },
        });
      }
    });

    this.builtInTemplates.forEach((template) => {
      const matchesName = template.name.toLowerCase().includes(lowerQuery);
      const matchesDescription = template.description
        .toLowerCase()
        .includes(lowerQuery);

      if (matchesName || matchesDescription || "preset".includes(lowerQuery)) {
        results.push({
          id: `param-preset-${template.id}`,
          type: "action",
          title: template.name,
          subtitle: `${template.parameters.variants.length} variants • ${template.parameters.windowLength}s window`,
          description: template.description,
          category: "Analysis Presets",
          icon: "Settings",
          keywords: [template.name, "parameters", "preset", "template"],
          metadata: { template },
          action: () => {
            state.setPrimaryNav("analyze");
          },
        });
      }
    });

    return results;
  }
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export class ExportHistorySearchProvider implements SearchProvider {
  name = "ExportHistory";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    const exports = useExportHistoryStore.getState().getRecentExports(50);

    exports.forEach((exportRecord) => {
      const matchesSource = exportRecord.sourceName
        .toLowerCase()
        .includes(lowerQuery);
      const matchesPath = exportRecord.outputPath
        .toLowerCase()
        .includes(lowerQuery);
      const matchesType = exportRecord.type.toLowerCase().includes(lowerQuery);
      const matchesFormat = exportRecord.format
        .toLowerCase()
        .includes(lowerQuery);

      const isExportQuery = ["export", "exported", "saved"].some((kw) =>
        lowerQuery.includes(kw),
      );

      if (
        matchesSource ||
        matchesPath ||
        matchesType ||
        matchesFormat ||
        isExportQuery
      ) {
        const iconMap: Record<string, string> = {
          "dda-results": "Brain",
          plot: "LineChart",
          file: "File",
          annotations: "MessageSquare",
        };

        const statusEmoji = exportRecord.status === "success" ? "✓" : "✗";
        const timeAgo = formatRelativeTime(exportRecord.timestamp);
        const sizeStr = exportRecord.fileSize
          ? formatFileSize(exportRecord.fileSize)
          : "";

        results.push({
          id: `export-${exportRecord.id}`,
          type: "action",
          title: `${statusEmoji} ${exportRecord.sourceName}`,
          subtitle: `${exportRecord.format.toUpperCase()} • ${timeAgo}${sizeStr ? ` • ${sizeStr}` : ""}`,
          description: exportRecord.outputPath,
          category: `Export History - ${exportRecord.type}`,
          icon: iconMap[exportRecord.type] || "File",
          keywords: [
            exportRecord.sourceName,
            exportRecord.outputPath,
            exportRecord.type,
            exportRecord.format,
            "export",
            "saved",
          ],
          metadata: { exportRecord },
          action: async () => {
            if (typeof window !== "undefined" && (window as any).__TAURI__) {
              const { invoke } = await import("@tauri-apps/api/core");
              try {
                await invoke("show_in_folder", {
                  path: exportRecord.outputPath,
                });
              } catch (err) {
                console.error("Failed to show in folder", err);
              }
            }
          },
        });
      }
    });

    return results.sort((a, b) => {
      const aExport = a.metadata?.exportRecord;
      const bExport = b.metadata?.exportRecord;

      if (aExport?.status !== bExport?.status) {
        return aExport?.status === "failed" ? -1 : 1;
      }

      return (bExport?.timestamp || 0) - (aExport?.timestamp || 0);
    });
  }
}

export class KeyboardShortcutsSearchProvider implements SearchProvider {
  name = "KeyboardShortcuts";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    const shortcuts = Array.from(
      useKeyboardShortcutsStore.getState().shortcuts.values(),
    );

    const isShortcutQuery = ["shortcut", "keyboard", "key", "hotkey"].some(
      (kw) => lowerQuery.includes(kw),
    );

    shortcuts.forEach((shortcut) => {
      const matchesLabel = shortcut.label.toLowerCase().includes(lowerQuery);
      const matchesDescription = shortcut.description
        .toLowerCase()
        .includes(lowerQuery);
      const matchesKey = shortcut.key.toLowerCase().includes(lowerQuery);
      const matchesContext = shortcut.context
        .toLowerCase()
        .includes(lowerQuery);
      const matchesCategory = shortcut.category
        ?.toLowerCase()
        .includes(lowerQuery);

      if (
        matchesLabel ||
        matchesDescription ||
        matchesKey ||
        matchesContext ||
        matchesCategory ||
        isShortcutQuery
      ) {
        const formattedShortcut = useKeyboardShortcutsStore
          .getState()
          .formatShortcut(shortcut);

        results.push({
          id: `shortcut-${shortcut.id}`,
          type: "action",
          title: shortcut.label,
          subtitle: formattedShortcut,
          description: shortcut.description,
          category: shortcut.category || "Keyboard Shortcuts",
          icon: "Keyboard",
          keywords: [
            shortcut.label,
            shortcut.description,
            shortcut.key,
            shortcut.context,
            "shortcut",
            "keyboard",
          ],
          metadata: { shortcut },
          action: async () => {
            try {
              await shortcut.action();
            } catch (err) {
              console.error("Failed to execute shortcut", err);
            }
          },
        });
      }
    });

    return results.sort((a, b) => {
      if (a.category !== b.category) {
        return (a.category || "").localeCompare(b.category || "");
      }
      return a.title.localeCompare(b.title);
    });
  }
}

export class NotificationsSearchProvider implements SearchProvider {
  name = "Notifications";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    const notifications = useNotificationStore.getState().notifications;
    const recentNotifications = notifications.slice(0, 50);

    const isNotificationQuery = [
      "notification",
      "error",
      "warning",
      "alert",
    ].some((kw) => lowerQuery.includes(kw));

    recentNotifications.forEach((notification) => {
      const matchesTitle = notification.title
        .toLowerCase()
        .includes(lowerQuery);
      const matchesMessage =
        notification.message?.toLowerCase().includes(lowerQuery) || false;
      const matchesType = notification.type.toLowerCase().includes(lowerQuery);
      const matchesCategory = notification.category
        .toLowerCase()
        .includes(lowerQuery);

      if (
        matchesTitle ||
        matchesMessage ||
        matchesType ||
        matchesCategory ||
        isNotificationQuery
      ) {
        const iconMap: Record<string, string> = {
          info: "Info",
          success: "CheckCircle",
          warning: "AlertTriangle",
          error: "XCircle",
        };

        const timeAgo = formatRelativeTime(notification.timestamp);

        results.push({
          id: `notification-${notification.id}`,
          type: "action",
          title: notification.title,
          subtitle: `${notification.type.toUpperCase()} • ${timeAgo}`,
          description: notification.message || "",
          category: `${notification.category} Notifications`,
          icon: iconMap[notification.type] || "Info",
          keywords: [
            notification.title,
            notification.message || "",
            notification.type,
            notification.category,
            "notification",
          ],
          metadata: { notification },
          action: () => {
            useNotificationStore.getState().markAsRead(notification.id);
            getState()?.setPrimaryNav("explore");
          },
        });
      }
    });

    return results.sort((a, b) => {
      const aNotif = a.metadata?.notification;
      const bNotif = b.metadata?.notification;

      if (aNotif?.read !== bNotif?.read) {
        return aNotif?.read ? 1 : -1;
      }

      return (bNotif?.timestamp || 0) - (aNotif?.timestamp || 0);
    });
  }
}

export class FileManagerSearchProvider implements SearchProvider {
  name = "FileManager";

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    const recentFiles = useRecentFilesStore.getState().recentFiles;

    recentFiles.forEach((file) => {
      const matchesName = file.name.toLowerCase().includes(lowerQuery);
      const matchesPath = file.path.toLowerCase().includes(lowerQuery);
      const matchesType = file.type.toLowerCase().includes(lowerQuery);

      if (matchesName || matchesPath || matchesType) {
        const channelInfo = file.metadata?.channels
          ? `${file.metadata.channels} ch`
          : "";
        const durationInfo = file.metadata?.duration
          ? `${file.metadata.duration.toFixed(1)}s`
          : "";
        const subtitle = [channelInfo, durationInfo]
          .filter(Boolean)
          .join(" • ");

        results.push({
          id: `file-manager-${file.path}`,
          type: "file",
          title: file.name,
          subtitle: subtitle || file.type.toUpperCase(),
          description: file.path,
          category: "Recent Files",
          icon: "File",
          keywords: [file.name, file.path, file.type],
          metadata: { file },
          action: async () => {
            await useOpenFilesStore.getState().openFile(file.path);
            getState()?.setPrimaryNav("explore");
          },
        });
      }
    });

    return results.sort((a, b) => {
      const aFile = a.metadata?.file;
      const bFile = b.metadata?.file;
      return (bFile?.lastAccessed || 0) - (aFile?.lastAccessed || 0);
    });
  }
}

export function getAllSearchProviders(): SearchProvider[] {
  return [
    // Dynamically registered items (highest priority - from components)
    new RegisteredItemsSearchProvider(),

    // Core navigation
    new NavigationSearchProvider(),
    new SettingsSearchProvider(),
    new ActionSearchProvider(),
    new QuickActionsSearchProvider(),

    // NEW: High-value user items (frequently accessed)
    new OpenFileTabsSearchProvider(),
    new BookmarksSearchProvider(),
    new KeyboardShortcutsSearchProvider(),

    // File & Data Management
    new FileSearchProvider(),
    new FileManagerSearchProvider(),
    new FileHistorySearchProvider(),
    new FileMetadataSearchProvider(),
    new FileFormatSearchProvider(),
    new DataSourceSearchProvider(),

    // Channels
    new ChannelSearchProvider(),

    // Analysis & Results
    new AnalysisSearchProvider(),
    new AnalysisPresetsSearchProvider(),
    new DDAVariantSearchProvider(),
    new AnalysisParametersSearchProvider(),
    new DelayPresetSearchProvider(),
    new AnalysisStatusSearchProvider(),
    new ICASearchProvider(),

    // NSG & Cloud
    new NSGJobSearchProvider(),

    // Streaming
    new StreamSessionSearchProvider(),

    // Annotations
    new AnnotationSearchProvider(),

    // NEW: Utilities
    new DashboardWidgetsSearchProvider(),
    new NotificationsSearchProvider(),
    new ExportHistorySearchProvider(),

    // Help
    new HelpSearchProvider(),
  ];
}
