---
sidebar_position: 3
---

# Your First Analysis

This tutorial walks you through running your first DDA analysis on EEG data.

## Prerequisites

- DDALAB installed and running
- A sample EEG file (EDF, BrainVision, or similar)

## Step 1: Load Your Data

1. Open DDALAB
2. Navigate to **File > Open** or press `Cmd/Ctrl + O`
3. Select your EEG file
4. Wait for the file to load (progress shown in status bar)

Once loaded, you'll see:

- File metadata in the info panel
- Available channels listed
- Recording duration and sample rate

## Step 2: Preview the Data

Before analysis, preview your data:

1. Click on channels in the channel list to view them
2. Use the time series viewer to scroll through the recording
3. Check for artifacts or segments you may want to exclude

:::tip Data Quality
Good quality data leads to better analysis results. Consider preprocessing (filtering, artifact rejection) if your data contains significant noise.
:::

## Step 3: Configure DDA Parameters

In the DDA Configuration panel, set your parameters:

### Embedding Dimension (m)

The number of dimensions for phase space reconstruction.

- **Typical range**: 2-10
- **Default**: 3
- Higher values capture more complex dynamics but require more computation

### Time Delay (τ)

The lag between successive points in the embedding.

- **Typical range**: 1-10 samples
- **Default**: 1
- Should be chosen based on your data's autocorrelation

### Delta Range

The range of delta values for the analysis.

- **Minimum**: Start of delta range
- **Maximum**: End of delta range
- **Step**: Increment between values

### Channel Selection

Select which channels to analyze:

- Click individual channels to toggle
- Use "Select All" for all channels
- Use "Select None" to clear selection

## Step 4: Run the Analysis

1. Review your configuration
2. Click **Run Analysis**
3. Monitor progress in the progress bar
4. Wait for completion

:::note Analysis Time
Analysis time depends on:

- Number of channels selected
- Recording duration
- Delta range size
- Your computer's processing power
  :::

## Step 5: Review Results

After completion, the DDA Results panel shows:

### Summary Statistics

- Mean, median, and standard deviation per channel
- Overall statistics across all channels

### Per-Channel Results

- DDA values for each delta
- Trend visualization

### Visualization

- Heatmap of results
- Line plots per channel
- Statistical distributions

## Step 6: Export Results

Save your results for further analysis:

1. Click **Export** in the results panel
2. Choose your format:
   - **CSV**: For spreadsheet analysis
   - **JSON**: For programmatic access
   - **MAT**: For MATLAB/Python analysis
3. Select destination folder
4. Click Save

## Example Analysis

Here's a typical workflow for analyzing sleep EEG:

```
1. Load: subject001_sleep.edf
2. Parameters:
   - m = 3
   - τ = 1
   - Delta: 1-100 (step 1)
   - Channels: Fp1, Fp2, F3, F4, C3, C4
3. Run analysis (~2 minutes for 8-hour recording)
4. Export as CSV for statistical analysis
```

## Troubleshooting

### Analysis Fails

- Check that channels contain valid data
- Ensure enough data points for chosen parameters
- Try reducing delta range

### Slow Performance

- Reduce number of channels
- Decrease delta range
- Close other applications

### Unexpected Results

- Verify data quality
- Check parameter appropriateness for your data
- Compare with known reference datasets

## Next Steps

- [DDA Analysis Guide](../user-guide/dda-analysis) - Advanced analysis techniques
- [Visualization](../user-guide/visualization) - Understanding result visualizations
- [Export Guide](../user-guide/export) - Detailed export options
