---
sidebar_position: 5
---

# Export Guide

Export data and results from DDALAB in various formats.

## Export Formats

### CSV

Comma-separated values for spreadsheet analysis.

```csv
channel,delta,value
Fp1,1,0.234
Fp1,2,0.456
...
```

### JSON

Structured format for programmatic access.

```json
{
  "metadata": {...},
  "results": [
    {"channel": "Fp1", "deltas": [...], "values": [...]}
  ]
}
```

### MATLAB (.mat)

For MATLAB and Python scipy analysis.

### EDF

Export processed data as EDF for other tools.

### Images

PNG, SVG, PDF for visualizations.

## Export Workflow

1. Complete analysis or select data
2. Click **Export** or File > Export
3. Choose format
4. Configure options
5. Select destination
6. Save

## Options

### Data Export

- Select channels to include
- Choose time range
- Apply preprocessing
- Include metadata

### Results Export

- Include statistics
- Include raw values
- Format precision
- File naming template

## Batch Export

Export multiple files:

1. Select files in manager
2. Configure export template
3. Choose output directory
4. Start batch export
