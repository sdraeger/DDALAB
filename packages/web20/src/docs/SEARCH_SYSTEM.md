# Generalized Search System

The generalized search system allows every component in the application to make itself searchable through a unified search interface. Users can search across files, pages, notifications, dashboard metrics, and any other content that components choose to expose.

## Architecture

### Core Components
- **SearchContext**: Provides the global search functionality
- **SearchProvider**: Wraps the app to provide search context
- **useSearchable**: Hook for components to register searchable content
- **useGlobalSearch**: Hook for consuming search functionality
- **SearchProviderRegistry**: Registers built-in search providers

### Built-in Search Providers
- **Files**: Searches through files and directories via API
- **Pages**: Searches application pages and navigation
- **Notifications**: Searches through user notifications

## Making Components Searchable

### Basic Usage

```tsx
import { useSearchable, useSearchableItems } from '@/hooks/useSearchable';

function MyComponent() {
  const items = useSearchableItems(
    'my-component',
    'content',
    data,
    (item, index) => ({
      title: item.name,
      description: item.description,
      keywords: [item.category, 'custom'],
      onSelect: () => console.log('Selected:', item),
    })
  );

  useSearchable({
    id: 'my-component',
    category: 'content',
    items,
    priority: 5,
  });

  return <div>{/* Your component JSX */}</div>;
}
```

### SearchableItem Interface

```tsx
interface SearchableItem {
  id: string;              // Unique identifier
  title: string;           // Display title
  description: string;     // Display description
  content?: string;        // Additional searchable content
  keywords?: string[];     // Search keywords
  category: string;        // Category for grouping
  componentId?: string;    // Source component
  path?: string;           // Navigation path
  icon?: React.ReactNode;  // Display icon
  onSelect?: () => void;   // Selection handler
  metadata?: Record<string, any>; // Additional data
}
```

### Advanced Search Provider

```tsx
import { SearchProvider } from '@/types/search';

const customSearchProvider: SearchProvider = {
  id: 'custom-provider',
  name: 'Custom Content',
  category: 'custom',
  priority: 8,
  search: async (query: string) => {
    // Custom search logic
    const results = await searchAPI(query);
    return results.map(item => ({
      id: item.id,
      title: item.title,
      description: item.summary,
      category: 'custom',
      onSelect: () => navigate(item.url),
    }));
  },
};

// Register the provider
const { registerProvider } = useSearchContext();
registerProvider(customSearchProvider);
```

## Examples

### Dashboard Stats (Metrics)
```tsx
function DashboardStats() {
  const stats = useDashboardStats();

  const statsItems = useSearchableItems(
    'dashboard-stats',
    'metrics',
    stats ? [
      { title: 'Total Artifacts', value: stats.totalArtifacts },
      { title: 'Active Users', value: stats.activeUsers },
    ] : [],
    (item) => ({
      title: `${item.title}: ${item.value}`,
      description: `Current ${item.title.toLowerCase()}`,
      keywords: ['dashboard', 'metrics', 'stats'],
    })
  );

  useSearchable({
    id: 'dashboard-stats',
    category: 'metrics',
    items: statsItems,
    priority: 7,
  });
}
```

### Notifications
```tsx
function NotificationDropdown() {
  const notifications = useNotifications();

  const notificationItems = useSearchableItems(
    'notifications',
    'notifications',
    notifications,
    (notification) => ({
      title: notification.title,
      description: notification.message,
      keywords: [notification.type, notification.category],
      icon: getNotificationIcon(notification.type),
      onSelect: () => {
        if (notification.actionUrl) {
          window.location.href = notification.actionUrl;
        }
      },
    })
  );

  useSearchable({
    id: 'notifications',
    category: 'notifications',
    items: notificationItems,
    priority: 6,
  });
}
```

## Search Features

### Global Search Interface
- Accessible via header search bar
- Keyboard shortcut: ⌘K / Ctrl+K
- Real-time search with debouncing
- Category-based result grouping
- Priority-based result ordering

### Search Categories
- **files**: File and directory search
- **navigation**: Pages and navigation items
- **notifications**: User notifications and alerts
- **metrics**: Dashboard statistics and metrics
- **content**: General content and data
- **custom**: Custom component content

### Priority System
Higher priority providers appear first in results:
- **10**: Files and documents
- **8**: Navigation and pages
- **7**: Dashboard metrics
- **6**: Notifications
- **5**: Default priority
- **0**: Lowest priority

## Best Practices

1. **Unique IDs**: Use descriptive, unique IDs for search providers
2. **Relevant Keywords**: Include meaningful keywords for better discoverability
3. **Clear Titles**: Use descriptive titles that help users understand content
4. **Appropriate Categories**: Choose or create appropriate categories
5. **Useful Actions**: Implement meaningful `onSelect` handlers
6. **Performance**: For large datasets, implement efficient search functions
7. **Cleanup**: Unregister providers when components unmount

## Integration Guide

1. **Add SearchProvider**: Ensure SearchProvider wraps your app
2. **Register Built-ins**: Include SearchProviderRegistry in your header
3. **Make Components Searchable**: Use useSearchable in relevant components
4. **Test Search**: Verify search works across all registered content
5. **Monitor Performance**: Check search performance with large datasets

The search system is designed to be extensible and performant, allowing any component to participate in the global search experience seamlessly.
