import { SearchProvider, SearchResult } from "@/types/search";
import { useAppStore } from "@/store/appStore";
import {
  navigationConfig,
  secondaryTabConfig,
  PrimaryNavTab,
  SecondaryNavTab,
} from "@/types/navigation";

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
            useAppStore.getState().setPrimaryNav(nav.id as PrimaryNavTab);
          },
        });
      }

      if (nav.secondaryTabs) {
        nav.secondaryTabs.forEach((tabId) => {
          const tab = secondaryTabConfig[tabId];
          if (!tab || (tab.enabled === false)) return;

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
                useAppStore.getState().setPrimaryNav(nav.id as PrimaryNavTab);
                useAppStore.getState().setSecondaryNav(tabId as SecondaryNavTab);
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
        kw.toLowerCase().includes(lowerQuery)
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
            useAppStore.getState().setPrimaryNav("manage");
            useAppStore.getState().setSecondaryNav("settings");
            setTimeout(() => {
              const element = document.getElementById(
                `settings-section-${section.id}`
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
    const state = useAppStore.getState();
    const selectedFile = state.fileManager.selectedFile;

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
            useAppStore.getState().setPrimaryNav("explore");
            useAppStore.getState().setSecondaryNav("timeseries");
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
    const state = useAppStore.getState();
    const selectedFile = state.fileManager.selectedFile;

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
              useAppStore.getState().setPrimaryNav("explore");
              useAppStore.getState().setSecondaryNav("timeseries");
              const currentChannels = useAppStore.getState().fileManager.selectedChannels;
              if (!currentChannels.includes(channel)) {
                useAppStore.getState().setSelectedChannels([...currentChannels, channel]);
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
    const state = useAppStore.getState();
    const analysisHistory = state.dda.analysisHistory;

    analysisHistory.forEach((analysis, index) => {
      const matchesId = analysis.id.toLowerCase().includes(lowerQuery);
      const matchesFile = analysis.file_path?.toLowerCase().includes(lowerQuery);
      const matchesName = analysis.name?.toLowerCase().includes(lowerQuery);
      const matchesChannels = analysis.channels?.some((ch) =>
        ch.toLowerCase().includes(lowerQuery)
      );
      const variants = analysis.results?.variants?.map(v => v.variant_name) || [];
      const matchesVariant = variants.some(v => v.toLowerCase().includes(lowerQuery));

      if (matchesId || matchesFile || matchesName || matchesChannels || matchesVariant) {
        const date = analysis.created_at
          ? new Date(analysis.created_at).toLocaleString()
          : "Unknown date";
        const fileName = analysis.file_path.split('/').pop() || analysis.file_path;
        const variantLabel = variants.length > 0 ? variants.join(", ") : "DDA";

        results.push({
          id: `analysis-${analysis.id}`,
          type: "analysis",
          title: `${variantLabel} Analysis`,
          subtitle: fileName,
          description: `${analysis.channels?.join(", ") || "No channels"} - ${date}`,
          category: "Analysis Results",
          icon: "Brain",
          keywords: [
            ...variants,
            ...(analysis.channels || []),
            fileName,
            analysis.name || "",
          ],
          metadata: { analysis },
          action: () => {
            useAppStore.getState().setCurrentAnalysis(analysis);
            useAppStore.getState().setPrimaryNav("analyze");
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
        useAppStore.getState().setPrimaryNav("analyze");
      },
    },
    {
      id: "open-file",
      title: "Open File",
      description: "Browse and open a data file",
      keywords: ["open", "file", "browse", "load"],
      icon: "FolderOpen",
      action: () => {
        useAppStore.getState().setPrimaryNav("explore");
        useAppStore.getState().setSidebarOpen(true);
      },
    },
    {
      id: "view-notifications",
      title: "View Notifications",
      description: "See all system notifications",
      keywords: ["notifications", "alerts", "messages"],
      icon: "Bell",
      action: () => {
        useAppStore.getState().setPrimaryNav("notifications");
      },
    },
    {
      id: "toggle-theme",
      title: "Toggle Theme",
      description: "Switch between light and dark mode",
      keywords: ["theme", "dark", "light", "mode", "appearance"],
      icon: "Palette",
      action: () => {
        const currentTheme = useAppStore.getState().ui.theme;
        const newTheme = currentTheme === "dark" ? "light" : "dark";
        useAppStore.getState().setTheme(newTheme);
      },
    },
    {
      id: "toggle-sidebar",
      title: "Toggle Sidebar",
      description: "Show or hide the file manager sidebar",
      keywords: ["sidebar", "file manager", "toggle", "hide", "show"],
      icon: "PanelLeft",
      action: () => {
        const isOpen = useAppStore.getState().ui.sidebarOpen;
        useAppStore.getState().setSidebarOpen(!isOpen);
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
        kw.toLowerCase().includes(lowerQuery)
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

export function getAllSearchProviders(): SearchProvider[] {
  return [
    new NavigationSearchProvider(),
    new SettingsSearchProvider(),
    new FileSearchProvider(),
    new ChannelSearchProvider(),
    new AnalysisSearchProvider(),
    new ActionSearchProvider(),
  ];
}
