---
sidebar_position: 3
---

# DDA Analysis Guide

Comprehensive guide to Delay Differential Analysis in DDALAB.

## Understanding DDA

Delay Differential Analysis is a method for characterizing the dynamics of time series data by analyzing how the rate of change varies with respect to delayed versions of the signal.

### Key Parameters

#### Embedding Dimension (m)

The number of dimensions used for phase space reconstruction.

- **Range**: 2-10 (typically 3-5)
- **Effect**: Higher values capture more complex dynamics
- **Trade-off**: Computation time increases with m

#### Time Delay (τ)

The lag between successive points in the embedding.

- **Range**: 1-20 samples (typically 1-5)
- **Effect**: Should match the characteristic timescale of your data
- **Selection**: Use autocorrelation or mutual information

#### Delta Range

The range of delta values for computing derivatives.

- **Components**: min, max, step
- **Typical**: 1-100 with step 1
- **Effect**: Larger ranges reveal multi-scale dynamics

## Analysis Workflow

### 1. Data Preparation

Before analysis:

- Load your file
- Select channels of interest
- Review data quality
- Consider preprocessing (filtering, artifact rejection)

### 2. Parameter Selection

Configure parameters based on your data:

| Data Type | Suggested m | Suggested τ | Delta Range |
| --------- | ----------- | ----------- | ----------- |
| EEG       | 3-5         | 1-3         | 1-100       |
| ECG       | 3           | 1           | 1-50        |
| EMG       | 3-4         | 1           | 1-100       |

### 3. Channel Selection

Select channels for analysis:

- Click individual channels
- Use Ctrl+Click for multiple selection
- "Select All" for batch analysis

### 4. Running Analysis

1. Click **Run Analysis**
2. Monitor progress bar
3. View real-time logs (optional)
4. Wait for completion

### 5. Interpreting Results

Results show:

- DDA values for each delta
- Statistical summaries
- Trend visualizations

## Advanced Topics

### Batch Processing

Analyze multiple files:

1. Select files in file manager
2. Configure common parameters
3. Queue batch job
4. Monitor progress

### Parallel Processing

DDALAB uses parallel processing for:

- Multi-channel analysis
- Multi-file batches
- Large delta ranges

Configure in Settings > Performance.

### Memory Management

For large files:

- Use channel subsets
- Process in segments
- Monitor memory usage

## Best Practices

1. **Start Simple**: Begin with default parameters
2. **Validate**: Compare with known results
3. **Document**: Record parameters used
4. **Iterate**: Refine based on results

## Troubleshooting

### Analysis Too Slow

- Reduce delta range
- Select fewer channels
- Enable parallel processing

### Out of Memory

- Reduce channel selection
- Process shorter segments
- Increase system RAM

### Unexpected Results

- Check data quality
- Verify parameter appropriateness
- Compare with reference datasets
