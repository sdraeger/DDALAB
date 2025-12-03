---
sidebar_position: 3
---

# Feature Components

Application-specific components for DDALAB functionality.

## FileManager

File browser and management interface.

```tsx
import { FileManager } from "@/components/FileManager";

<FileManager
  onFileSelect={(file) => loadFile(file)}
  showRecent={true}
  allowMultiple={false}
/>;
```

**Props:**

- `onFileSelect`: Callback when file is selected
- `showRecent`: Show recent files panel
- `allowMultiple`: Allow multi-file selection

## DDAAnalysis

DDA configuration and execution panel.

```tsx
import { DDAAnalysis } from "@/components/DDAAnalysis";

<DDAAnalysis
  fileInfo={currentFile}
  channels={availableChannels}
  onAnalysisStart={(config) => startAnalysis(config)}
  onAnalysisComplete={(results) => showResults(results)}
/>;
```

## DDAResults

Results display and export.

```tsx
import { DDAResults } from "@/components/DDAResults";

<DDAResults
  results={analysisResults}
  onExport={(format) => exportResults(format)}
  view="heatmap"
/>;
```

## TimeSeriesPlotECharts

Interactive time series visualization.

```tsx
import { TimeSeriesPlotECharts } from "@/components/TimeSeriesPlotECharts";

<TimeSeriesPlotECharts
  data={channelData}
  channels={["Fp1", "Fp2"]}
  timeRange={[0, 10]}
  onRangeChange={(range) => updateRange(range)}
/>;
```

## SettingsPanel

Application settings interface.

```tsx
import { SettingsPanel } from "@/components/SettingsPanel";

<SettingsPanel
  settings={currentSettings}
  onSave={(settings) => saveSettings(settings)}
/>;
```

## NSGJobManager

NSG (Neuroscience Gateway) job management.

```tsx
import { NSGJobManager } from "@/components/NSGJobManager";

<NSGJobManager onJobComplete={(job) => handleResults(job)} />;
```
