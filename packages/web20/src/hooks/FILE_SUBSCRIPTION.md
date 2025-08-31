# File Selection Subscription System

This documentation explains how to use the new file selection subscription system that allows widgets to automatically react when a file is selected in the application.

## Overview

The file selection subscription system provides a generalized way for widgets to respond to file selection events. When a file is selected (e.g., through the FileBrowserWidget), all subscribed widgets will be notified immediately with the file information.

## How It Works

1. When a file is selected, the system dispatches a `FileSelectionEvent` to all subscribers
2. Widgets can subscribe to these events using the `useCurrentFileSubscription` hook
3. When a widget subscribes, it immediately receives the last known file selection event (if any)
4. All future file selection events are automatically delivered to subscribed widgets

## Usage in Widgets

To make a widget react to file selection events, follow these steps:

1. Import the hook:
```typescript
import { useCurrentFileSubscription } from "@shared/hooks/useCurrentFileSubscription";
```

2. Use the hook in your widget component:
```typescript
// In your widget component
useCurrentFileSubscription((event) => {
  // This callback will be called whenever a file is selected
  if (event.filePath) {
    // Update your widget state with the selected file
    setFilePath(event.filePath);
  }

  // You can also access metadata and other file information
  if (event.metadata) {
    setFileMetadata(event.metadata);
  }

  if (Array.isArray(event.selectedChannels)) {
    setSelectedChannels(event.selectedChannels);
  }
});
```

## FileSelectionEvent Interface

The event object passed to subscribers has the following structure:

```typescript
interface FileSelectionEvent {
  filePath: string | null;           // Path to the selected file
  metadata?: any;                    // File metadata
  edfData?: any;                     // EDF data if available
  selectedChannels?: string[];       // Currently selected channels
}
```

## Example Implementation

Here's a complete example of how to update a widget to use the file subscription system:

```typescript
import React, { useState } from "react";
import { useCurrentFileSubscription } from "@shared/hooks/useCurrentFileSubscription";

export function MyWidget() {
  const [filePath, setFilePath] = useState<string>("");
  const [metadata, setMetadata] = useState<any>(null);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

  // Subscribe to file selection events
  useCurrentFileSubscription((event) => {
    if (event.filePath) {
      setFilePath(event.filePath);
    }

    if (event.metadata) {
      setMetadata(event.metadata);
    }

    if (Array.isArray(event.selectedChannels)) {
      setSelectedChannels(event.selectedChannels);
    }
  });

  return (
    <div>
      <h2>My Widget</h2>
      <p>Selected File: {filePath || "None"}</p>
      <p>Channels: {selectedChannels.join(", ")}</p>
    </div>
  );
}
```

## Benefits

1. **Immediate Reaction**: Widgets react immediately when a file is selected
2. **Consistent API**: All widgets use the same subscription pattern
3. **Automatic Updates**: No need to manually trigger updates in each widget
4. **Type Safety**: Full TypeScript support with defined event interfaces
5. **Backward Compatibility**: Existing event-based systems continue to work

## Best Practices

1. Always check if `event.filePath` exists before using it
2. Handle cases where metadata or other properties might be undefined
3. Use the subscription hook at the top level of your component
4. Avoid heavy operations in the subscription callback to maintain performance
5. Remember that the callback is called immediately upon subscription with the last known event
