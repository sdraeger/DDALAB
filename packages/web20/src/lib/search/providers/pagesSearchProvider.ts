import { SearchProvider, SearchableItem } from '@/types/search';
import { LayoutGrid, BarChart3, Users, Database, Settings, FileText } from 'lucide-react';
import React from 'react';

const pages = [
  {
    name: 'Dashboard',
    path: '/',
    description: 'Main dashboard with widgets and analytics',
    keywords: ['home', 'main', 'overview', 'widgets', 'charts'],
    icon: LayoutGrid,
  },
  {
    name: 'Analytics',
    path: '/analytics',
    description: 'View analytics and reports',
    keywords: ['reports', 'metrics', 'data', 'insights'],
    icon: BarChart3,
  },
  {
    name: 'Users',
    path: '/users',
    description: 'Manage users and permissions',
    keywords: ['accounts', 'permissions', 'roles', 'admin'],
    icon: Users,
  },
  {
    name: 'Database',
    path: '/database',
    description: 'Database management tools',
    keywords: ['sql', 'tables', 'queries', 'data'],
    icon: Database,
  },
  {
    name: 'Documents',
    path: '/documents',
    description: 'Browse and manage files',
    keywords: ['files', 'upload', 'download', 'browse'],
    icon: FileText,
  },
  {
    name: 'Settings',
    path: '/settings',
    description: 'Application settings and preferences',
    keywords: ['config', 'preferences', 'theme', 'options'],
    icon: Settings,
  },
];

export const pagesSearchProvider: SearchProvider = {
  id: 'pages',
  name: 'Pages',
  category: 'navigation',
  priority: 8,
  search: (query: string): SearchableItem[] => {
    const lowercaseQuery = query.toLowerCase();
    
    return pages
      .filter(page => {
        const searchText = [
          page.name,
          page.description,
          ...page.keywords,
        ].join(' ').toLowerCase();
        
        return searchText.includes(lowercaseQuery);
      })
      .map(page => ({
        id: `page-${page.path}`,
        title: page.name,
        description: page.description,
        category: 'navigation',
        path: page.path,
        icon: React.createElement(page.icon, { className: 'h-4 w-4' }),
        keywords: page.keywords,
        onSelect: () => {
          window.location.href = page.path;
        },
        metadata: {
          pageType: 'navigation',
        },
      }))
      .sort((a, b) => {
        // Prioritize exact name matches
        const aExact = a.title.toLowerCase() === lowercaseQuery;
        const bExact = b.title.toLowerCase() === lowercaseQuery;
        
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        
        return 0;
      });
  },
};