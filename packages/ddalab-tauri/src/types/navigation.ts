export type PrimaryNavTab = 'overview' | 'explore' | 'analyze' | 'manage' | 'notifications'

export type SecondaryNavTab =
  // Explore tabs
  | 'timeseries'
  | 'annotations'
  | 'spectrograms'
  | 'power-spectrum'
  // Analyze tabs
  | 'dda'
  | 'meg-analysis'
  | 'connectivity'
  | 'statistics'
  // Manage tabs
  | 'settings'
  | 'data-sources'
  | 'jobs'

export interface NavigationCategory {
  id: PrimaryNavTab
  label: string
  icon: string
  description: string
  secondaryTabs: SecondaryNavTab[] | null
}

export interface SecondaryTabConfig {
  id: SecondaryNavTab
  label: string
  icon?: string
  description?: string
  enabled?: boolean
}

export const navigationConfig: Record<PrimaryNavTab, NavigationCategory> = {
  overview: {
    id: 'overview',
    label: 'Overview',
    icon: 'Home',
    description: 'Dashboard and quick access',
    secondaryTabs: null,
  },
  explore: {
    id: 'explore',
    label: 'Explore',
    icon: 'BarChart3',
    description: 'Data visualization and inspection',
    secondaryTabs: ['timeseries', 'annotations'],
  },
  analyze: {
    id: 'analyze',
    label: 'Analyze',
    icon: 'Brain',
    description: 'Analysis tools and methods',
    secondaryTabs: ['dda'],
  },
  manage: {
    id: 'manage',
    label: 'Manage',
    icon: 'Settings',
    description: 'Settings and data sources',
    secondaryTabs: ['settings', 'data-sources', 'jobs'],
  },
  notifications: {
    id: 'notifications',
    label: 'Notifications',
    icon: 'Bell',
    description: 'System notifications and alerts',
    secondaryTabs: null,
  },
}

export const secondaryTabConfig: Record<SecondaryNavTab, SecondaryTabConfig> = {
  // Explore
  timeseries: {
    id: 'timeseries',
    label: 'Time Series',
    icon: 'Activity',
    description: 'View and explore time series data',
  },
  annotations: {
    id: 'annotations',
    label: 'Annotations',
    icon: 'MessageSquare',
    description: 'Manage annotations',
  },
  spectrograms: {
    id: 'spectrograms',
    label: 'Spectrograms',
    icon: 'Waves',
    description: 'Frequency-time analysis',
    enabled: false,
  },
  'power-spectrum': {
    id: 'power-spectrum',
    label: 'Power Spectrum',
    icon: 'LineChart',
    description: 'Frequency domain analysis',
    enabled: false,
  },

  // Analyze
  dda: {
    id: 'dda',
    label: 'DDA',
    icon: 'Brain',
    description: 'Delay Differential Analysis',
  },
  'meg-analysis': {
    id: 'meg-analysis',
    label: 'MEG Analysis',
    icon: 'Cpu',
    description: 'MEG-specific analysis tools',
    enabled: false,
  },
  connectivity: {
    id: 'connectivity',
    label: 'Connectivity',
    icon: 'Network',
    description: 'Functional connectivity analysis',
    enabled: false,
  },
  statistics: {
    id: 'statistics',
    label: 'Statistics',
    icon: 'TrendingUp',
    description: 'Statistical analysis',
    enabled: false,
  },

  // Manage
  settings: {
    id: 'settings',
    label: 'Settings',
    icon: 'Settings',
    description: 'Application settings',
  },
  'data-sources': {
    id: 'data-sources',
    label: 'Data Sources',
    icon: 'Database',
    description: 'External data sources',
  },
  jobs: {
    id: 'jobs',
    label: 'Jobs',
    icon: 'Cloud',
    description: 'Remote computation jobs',
  },
}
