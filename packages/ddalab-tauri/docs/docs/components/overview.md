---
sidebar_position: 1
---

# Component Library Overview

DDALAB's UI is built with reusable React components using Radix UI primitives and Tailwind CSS.

## Component Architecture

```
components/
├── ui/              # Core UI primitives
│   ├── button.tsx
│   ├── input.tsx
│   ├── card.tsx
│   └── ...
└── [feature]/       # Feature-specific components
    ├── FileManager.tsx
    ├── DDAAnalysis.tsx
    └── ...
```

## UI Components

Core building blocks based on shadcn/ui design system.

### Interactive Components

| Component | Description                                                  |
| --------- | ------------------------------------------------------------ |
| Button    | Primary interaction element with variants and loading states |
| Input     | Form input with validation states                            |
| Select    | Dropdown selection                                           |
| Switch    | Boolean toggle                                               |
| Slider    | Range selection                                              |
| Checkbox  | Multi-select option                                          |

### Layout Components

| Component  | Description          |
| ---------- | -------------------- |
| Card       | Content container    |
| Dialog     | Modal dialogs        |
| Tabs       | Content organization |
| Accordion  | Collapsible sections |
| ScrollArea | Custom scrollbar     |

### Feedback Components

| Component | Description        |
| --------- | ------------------ |
| Progress  | Progress indicator |
| Badge     | Status labels      |
| Alert     | User notifications |
| Tooltip   | Contextual help    |
| Toast     | Temporary messages |

## Feature Components

Application-specific components.

### FileManager

File browser and management.

```tsx
import { FileManager } from "@/components/FileManager";

<FileManager onFileSelect={(file) => handleFile(file)} showRecent={true} />;
```

### DDAAnalysis

DDA configuration and execution.

```tsx
import { DDAAnalysis } from "@/components/DDAAnalysis";

<DDAAnalysis
  fileInfo={currentFile}
  onAnalysisComplete={(results) => handleResults(results)}
/>;
```

### DDAResults

Results visualization.

```tsx
import { DDAResults } from "@/components/DDAResults";

<DDAResults
  results={analysisResults}
  onExport={(format) => exportResults(format)}
/>;
```

### TimeSeriesPlot

Interactive time series visualization.

```tsx
import { TimeSeriesPlotECharts } from "@/components/TimeSeriesPlotECharts";

<TimeSeriesPlotECharts
  data={channelData}
  channels={selectedChannels}
  zoomRange={[0, 10]}
/>;
```

## Design Tokens

CSS custom properties for theming.

### Colors

```css
/* Primary */
--primary: 222.2 47.4% 11.2%;
--primary-foreground: 210 40% 98%;

/* Secondary */
--secondary: 210 40% 96.1%;
--secondary-foreground: 222.2 47.4% 11.2%;

/* Destructive */
--destructive: 0 84.2% 60.2%;
--destructive-foreground: 210 40% 98%;
```

### Spacing

Uses Tailwind's spacing scale (0.25rem increments).

### Typography

- Font: System UI stack
- Sizes: Tailwind defaults (text-xs through text-4xl)
- Weights: 400 (normal), 500 (medium), 600 (semibold), 700 (bold)

## Storybook

Interactive component documentation.

### Run Storybook

```bash
npm run storybook
```

Opens at http://localhost:6006

### Build Storybook

```bash
npm run build-storybook
```

Generates static site in `storybook-static/`.

## Contributing Components

### Creating a New Component

1. Create file in appropriate directory
2. Follow existing patterns
3. Export from index
4. Add Storybook stories
5. Document props

### Component Template

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface MyComponentProps {
  /** Description */
  prop: string;
}

const MyComponent = React.forwardRef<HTMLDivElement, MyComponentProps>(
  ({ prop, className, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("base-styles", className)} {...props} />
    );
  },
);
MyComponent.displayName = "MyComponent";

export { MyComponent };
```
