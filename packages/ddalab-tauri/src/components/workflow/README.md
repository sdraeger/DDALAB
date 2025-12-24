# Workflow Recording Integration Guide

This guide shows how to integrate workflow recording into DDALAB components using Phase 2 infrastructure.

## Quick Start

### 1. Add WorkflowRecorder Component to Main UI

Add the `WorkflowRecorder` component to your main layout (typically in the header or toolbar):

```tsx
import { WorkflowRecorder } from "@/components/workflow/WorkflowRecorder";

export function MainLayout() {
  return (
    <div>
      <header className="flex items-center justify-between p-4">
        <h1>DDALAB</h1>
        <WorkflowRecorder />
      </header>
      {/* ... rest of layout */}
    </div>
  );
}
```

### 2. Record Actions in Components

Use the `useWorkflowRecording` hook in your components:

```tsx
import { useWorkflowRecording } from "@/hooks/useWorkflowRecording";

export function FileLoader() {
  const { recordLoadFile } = useWorkflowRecording();

  const handleLoadFile = async (path: string) => {
    // Your existing file loading logic
    const fileType = path.endsWith(".edf") ? "EDF" : "CSV";
    await loadFile(path);

    // Record the action
    await recordLoadFile(path, fileType);
  };

  return (
    <button onClick={() => handleLoadFile("/path/to/file.edf")}>
      Load File
    </button>
  );
}
```

## Integration Examples

### File Loading

```tsx
// In FileManager.tsx or similar
import { useWorkflowRecording } from "@/hooks/useWorkflowRecording";

export function FileManager() {
  const { recordLoadFile, recordCloseFile } = useWorkflowRecording();

  const loadFile = async (path: string) => {
    const ext = path.split(".").pop()?.toLowerCase();
    let fileType: "EDF" | "ASCII" | "CSV" = "EDF";
    if (ext === "csv") fileType = "CSV";
    else if (ext === "ascii" || ext === "txt") fileType = "ASCII";

    // Load file
    const fileInfo = await apiService.loadFile(path);

    // Record action
    await recordLoadFile(path, fileType);
  };

  const closeFile = async (fileId: string) => {
    await apiService.closeFile(fileId);
    await recordCloseFile(fileId);
  };

  return (/* ... */);
}
```

### Channel Selection

```tsx
// In ChannelSelector.tsx or similar
import { useWorkflowRecording } from "@/hooks/useWorkflowRecording";

export function ChannelSelector() {
  const {
    recordSelectChannels,
    recordDeselectChannels,
    recordSelectAllChannels,
    recordClearChannelSelection,
  } = useWorkflowRecording();

  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);

  const toggleChannel = async (index: number) => {
    const isSelected = selectedChannels.includes(index);

    if (isSelected) {
      setSelectedChannels(prev => prev.filter(i => i !== index));
      await recordDeselectChannels([index]);
    } else {
      setSelectedChannels(prev => [...prev, index]);
      await recordSelectChannels([index]);
    }
  };

  const selectAll = async () => {
    setSelectedChannels(allChannelIndices);
    await recordSelectAllChannels();
  };

  const clearSelection = async () => {
    setSelectedChannels([]);
    await recordClearChannelSelection();
  };

  return (/* ... */);
}
```

### DDA Configuration

```tsx
// In DDAConfig.tsx or ModelBuilder.tsx
import { useWorkflowRecording } from "@/hooks/useWorkflowRecording";

export function DDAConfiguration() {
  const {
    recordSetDDAParameters,
    recordSelectDDAVariants,
    recordSetDelayList,
    recordSetModelParameters,
  } = useWorkflowRecording();

  const handleWindowChange = async (windowLength: number, windowStep: number) => {
    setDDAConfig({ windowLength, windowStep });
    await recordSetDDAParameters(windowLength, windowStep);
  };

  const handleVariantSelection = async (variants: string[]) => {
    setSelectedVariants(variants);
    await recordSelectDDAVariants(variants);
  };

  const handleDelayListChange = async (delays: number[]) => {
    setDelayList(delays);
    await recordSetDelayList(delays);
  };

  const handleModelParamsChange = async (
    dm: number,
    order: number,
    nrTau: number,
    encoding: number[]
  ) => {
    setModelParams({ dm, order, nrTau, encoding });
    await recordSetModelParameters(dm, order, nrTau, encoding);
  };

  return (/* ... */);
}
```

### Running DDA Analysis

```tsx
// In DDAAnalysisRunner.tsx or similar
import { useWorkflowRecording } from "@/hooks/useWorkflowRecording";

export function DDAAnalysisRunner() {
  const { recordRunDDAAnalysis } = useWorkflowRecording();

  const runAnalysis = async () => {
    const inputId = activeFile?.id || "unknown";
    const channelSelection = selectedChannels;
    const ctPairs = selectedVariants.includes("cross_timeseries")
      ? [[0, 1], [1, 2]]
      : undefined;

    // Run the analysis
    const result = await apiService.runDDA({
      inputId,
      channelSelection,
      ctPairs,
    });

    // Record the action
    await recordRunDDAAnalysis(inputId, channelSelection, ctPairs);

    return result;
  };

  return (/* ... */);
}
```

### Time Window Selection

```tsx
// In TimeWindowSelector.tsx or similar
import { useWorkflowRecording } from "@/hooks/useWorkflowRecording";

export function TimeWindowSelector() {
  const { recordSetTimeWindow } = useWorkflowRecording();

  const handleTimeWindowChange = async (start: number, end: number) => {
    setTimeWindow({ start, end });
    await recordSetTimeWindow(start, end);
  };

  return (/* ... */);
}
```

## Advanced: Custom Actions

For actions not covered by the hook, use the generic `recordAction`:

```tsx
import { useWorkflowRecording } from "@/hooks/useWorkflowRecording";

export function MyComponent() {
  const { recordAction } = useWorkflowRecording();

  const handleCustomAction = async () => {
    await recordAction({
      type: "ApplyPreprocessing",
      data: {
        input_id: "file_123",
        preprocessing: {
          highpass: 1.0,
          lowpass: 40.0,
          notch: [50, 60],
        },
      },
    });
  };

  return (/* ... */);
}
```

## Best Practices

1. **Record After Success**: Only record actions after they successfully complete
2. **Include Context**: The hook automatically includes active file ID
3. **Don't Block UI**: Recording is async and won't block user interactions
4. **Error Handling**: Recording errors are logged but won't break your app
5. **Conditional Recording**: Recording only happens when auto-record is enabled

## File Context

The `useWorkflowRecording` hook automatically includes the active file ID from the app store. If you need to override this:

```tsx
import { invoke } from "@tauri-apps/api/core";

// Manually specify file context
await invoke("workflow_auto_record", {
  action: { type: "SelectChannels", data: { channel_indices: [0, 1] } },
  activeFileId: "specific_file_id",
});
```

## Testing Recording

1. Click "Start Recording" in the WorkflowRecorder component
2. Perform actions in the UI (load file, select channels, etc.)
3. Open the export dialog to see recorded actions
4. Export as Python or Julia code
5. Run the exported code to verify it reproduces your workflow

## Next Steps

- Phase 3: Implement optimization passes to clean up recorded actions
- Phase 4: Add language plugins for MATLAB, Rust, R
- Phase 5: Add UI polish (recording indicator, action preview, etc.)
