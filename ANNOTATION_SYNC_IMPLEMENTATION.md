# Annotation Sync Feature Implementation

## Overview
Each annotation has a simple **sync toggle** that controls whether it appears across all plot types or only in the plot where it was created.

## Data Model

### Rust (annotation_db.rs)
```rust
pub struct AnnotationSource {
    pub plot_type: String,           // "timeseries" or "dda"
    pub variant_id: Option<String>,  // DDA variant ID if applicable
    pub dda_plot_type: Option<String>, // "heatmap" or "lineplot" if DDA
}

pub struct Annotation {
    pub id: String,
    pub position: f64,
    pub label: String,
    pub color: Option<String>,
    pub description: Option<String>,
    pub sync_enabled: bool,           // Simple on/off toggle
    pub created_in: Option<AnnotationSource>, // Where it was created
}
```

### TypeScript (annotations.ts)
```typescript
export interface AnnotationSource {
  plot_type: 'timeseries' | 'dda'
  variant_id?: string
  dda_plot_type?: 'heatmap' | 'lineplot'
}

export interface PlotAnnotation {
  id: string
  position: number
  label: string
  description?: string
  color?: string
  createdAt: string
  sync_enabled?: boolean
  created_in?: AnnotationSource
}
```

## Filtering Logic

### When sync_enabled = true
- Show annotation in ALL plot types (timeseries, DDA heatmap, DDA line plot for all variants)

### When sync_enabled = false
- Only show annotation in the plot matching `created_in`
- Example: If created in DDA heatmap for variant "single_timeseries", only show there

## Remaining Implementation Tasks

### 1. Update useAnnotations.ts
- Replace `AnnotationVisibility` with `boolean sync_enabled`
- Replace `visible_in` with `created_in`
- Update filtering logic in `useTimeSeriesAnnotations`:
  ```typescript
  return allAnnotations.filter(ann => {
    if (ann.sync_enabled === undefined || ann.sync_enabled === true) return true
    // Check if annotation was created in timeseries plot
    return ann.created_in?.plot_type === 'timeseries'
  })
  ```
- Update filtering logic in `useDDAAnnotations`:
  ```typescript
  .filter(ann => {
    if (ann.sync_enabled === undefined || ann.sync_enabled === true) return true
    // Check if annotation was created in this specific DDA plot
    return ann.created_in?.plot_type === 'dda' &&
           ann.created_in?.variant_id === variantId &&
           ann.created_in?.dda_plot_type === plotType
  })
  ```

### 2. Update DDAResults.tsx
- Update AnnotationContextMenu props:
  ```typescript
  currentPlotSource={{
    plot_type: 'dda',
    variant_id: getCurrentVariantData()?.variant_id,
    dda_plot_type: 'heatmap' // or 'lineplot'
  }}
  ```

### 3. Update TimeSeriesPlotECharts.tsx (if applicable)
- Pass `currentPlotSource={{ plot_type: 'timeseries' }}`

### 4. Install Required Package
```bash
npm install @radix-ui/react-switch --workspace=packages/ddalab-tauri
```

## UI Component

The AnnotationContextMenu now shows a simple switch:
```
Sync Across Plots         [Toggle Switch]
Visible in all plot types
```

When toggled off:
```
Sync Across Plots         [Toggle Switch]
Only visible here
```

## Database Schema

```sql
CREATE TABLE annotations (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    channel TEXT,
    position REAL NOT NULL,
    label TEXT NOT NULL,
    color TEXT,
    description TEXT,
    sync_enabled INTEGER DEFAULT 1,  -- 1 = true, 0 = false
    created_in TEXT,                  -- JSON serialized AnnotationSource
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

## Benefits of This Approach

1. **Simplicity**: Single toggle vs. complex checkbox matrix
2. **Scalability**: Adding new DDA variants requires no code changes
3. **User-friendly**: Clear on/off semantics
4. **Efficient**: Simple boolean check instead of complex visibility map lookups
5. **Flexible**: Can still determine exact origin via `created_in` field

