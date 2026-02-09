export type PrimaryNavTab =
  | "overview"
  | "explore"
  | "analyze"
  | "data"
  | "learn"
  | "plugins"
  | "collaborate"
  | "settings"
  | "notifications";

export type SecondaryNavTab =
  // Explore tabs
  | "timeseries"
  | "annotations"
  | "streaming"
  | "spectrograms"
  | "power-spectrum"
  // Analyze tabs
  | "dda"
  | "ica"
  | "batch"
  | "compare"
  | "meg-analysis"
  | "connectivity"
  | "statistics"
  // Data tabs
  | "openneuro"
  | "nsg-jobs"
  // Learn tabs
  | "tutorials"
  | "sample-data"
  | "papers"
  // Collaborate tabs
  | "gallery";

export interface NavigationCategory {
  id: PrimaryNavTab;
  label: string;
  icon: string;
  description: string;
  secondaryTabs: SecondaryNavTab[] | null;
}

export interface SecondaryTabConfig {
  id: SecondaryNavTab;
  label: string;
  icon?: string;
  description?: string;
  enabled?: boolean;
}

export const navigationConfig: Record<PrimaryNavTab, NavigationCategory> = {
  overview: {
    id: "overview",
    label: "Overview",
    icon: "Home",
    description: "Dashboard and quick access",
    secondaryTabs: null,
  },
  explore: {
    id: "explore",
    label: "Visualize",
    icon: "BarChart3",
    description: "Data visualization and inspection",
    secondaryTabs: ["timeseries", "annotations", "streaming"],
  },
  analyze: {
    id: "analyze",
    label: "Analyze",
    icon: "Brain",
    description: "Signal analysis tools",
    secondaryTabs: ["dda", "ica", "batch", "compare"],
  },
  data: {
    id: "data",
    label: "Data",
    icon: "Database",
    description: "Data repositories and cloud jobs",
    secondaryTabs: ["openneuro", "nsg-jobs"],
  },
  learn: {
    id: "learn",
    label: "Learn",
    icon: "GraduationCap",
    description: "Tutorials, sample data, and paper reproductions",
    secondaryTabs: ["tutorials", "sample-data", "papers"],
  },
  plugins: {
    id: "plugins",
    label: "Plugins",
    icon: "Puzzle",
    description: "Install and manage analysis plugins",
    secondaryTabs: null,
  },
  collaborate: {
    id: "collaborate",
    label: "Collaborate",
    icon: "Users",
    description: "Share results and work with teams",
    secondaryTabs: ["gallery"],
  },
  settings: {
    id: "settings",
    label: "Settings",
    icon: "Settings",
    description: "Application preferences",
    secondaryTabs: null,
  },
  notifications: {
    id: "notifications",
    label: "Notifications",
    icon: "Bell",
    description: "System notifications and alerts",
    secondaryTabs: null,
  },
};

export const secondaryTabConfig: Record<SecondaryNavTab, SecondaryTabConfig> = {
  // Explore/Visualize
  timeseries: {
    id: "timeseries",
    label: "Time Series",
    icon: "Activity",
    description: "View and explore time series data",
  },
  annotations: {
    id: "annotations",
    label: "Annotations",
    icon: "MessageSquare",
    description: "Manage annotations",
  },
  streaming: {
    id: "streaming",
    label: "Streaming",
    icon: "Radio",
    description: "Real-time data streaming and DDA analysis",
  },
  spectrograms: {
    id: "spectrograms",
    label: "Spectrograms",
    icon: "Waves",
    description: "Frequency-time analysis",
    enabled: false,
  },
  "power-spectrum": {
    id: "power-spectrum",
    label: "Power Spectrum",
    icon: "LineChart",
    description: "Frequency domain analysis",
    enabled: false,
  },

  // Analyze
  dda: {
    id: "dda",
    label: "DDA",
    icon: "Brain",
    description: "Delay Differential Analysis",
  },
  ica: {
    id: "ica",
    label: "ICA",
    icon: "Sparkles",
    description: "Independent Component Analysis",
  },
  batch: {
    id: "batch",
    label: "Batch",
    icon: "Layers",
    description: "Batch processing across multiple files",
  },
  compare: {
    id: "compare",
    label: "Compare",
    icon: "GitCompareArrows",
    description: "Compare results across subjects or conditions",
  },
  "meg-analysis": {
    id: "meg-analysis",
    label: "MEG Analysis",
    icon: "Cpu",
    description: "MEG-specific analysis tools",
    enabled: false,
  },
  connectivity: {
    id: "connectivity",
    label: "Connectivity",
    icon: "Network",
    description: "Functional connectivity analysis",
    enabled: false,
  },
  statistics: {
    id: "statistics",
    label: "Statistics",
    icon: "TrendingUp",
    description: "Statistical analysis",
    enabled: false,
  },

  // Data
  openneuro: {
    id: "openneuro",
    label: "OpenNeuro",
    icon: "Database",
    description: "Browse and download OpenNeuro datasets",
  },
  "nsg-jobs": {
    id: "nsg-jobs",
    label: "NSG Jobs",
    icon: "Cloud",
    description: "Neuroscience Gateway cloud computing",
  },

  // Learn
  tutorials: {
    id: "tutorials",
    label: "Tutorials",
    icon: "BookOpen",
    description: "Interactive step-by-step guides",
  },
  "sample-data": {
    id: "sample-data",
    label: "Sample Data",
    icon: "Download",
    description: "Download example datasets",
  },
  papers: {
    id: "papers",
    label: "Papers",
    icon: "FileSearch",
    description: "Reproduce results from published papers",
  },

  // Collaborate
  gallery: {
    id: "gallery",
    label: "Gallery",
    icon: "Globe",
    description: "Generate static sites from DDA results",
  },
};
