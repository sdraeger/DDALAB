# DDA-PY Demo Scripts

This directory contains demonstration scripts for the DDA (Delay Differential Analysis) Python package used in DDALAB.

## Files

### 1. `dda_py_demo.py` - Comprehensive Demo
A full-featured demonstration that shows:
- Synthetic EEG data generation
- DDA analysis with sliding windows
- Feature extraction and analysis
- Preprocessing effects (filtering, downsampling)
- Visualization of results

**Usage:**
```bash
python dda_py_demo.py [optional_edf_file.edf]
```

**Features demonstrated:**
- Multi-channel EEG simulation
- DDA Q-matrix computation
- Channel pair analysis
- Time-frequency visualization
- Statistical feature extraction

### 2. `dda_py_simple_demo.py` - API Usage Demo
A simpler script focusing on the actual dda_py API patterns used in DDALAB:
- Basic dda_py import and usage
- DDALAB service pattern examples
- Preprocessing pipeline configuration
- Code examples for integration

**Usage:**
```bash
python dda_py_simple_demo.py
```

## Sample Data

For testing with real EEG data, you'll need:
- EDF files (European Data Format)
- Multi-channel recordings (minimum 2 channels)
- Sampling rate of 256 Hz or higher recommended

## Installation Requirements

```bash
# Core requirements
pip install numpy matplotlib scipy

# For actual DDA processing
pip install dda-py  # The DDA processing package

# For EDF file handling (optional)
pip install mne pyedflib
```

## Expected Output

Both scripts will generate:
1. Console output with analysis statistics
2. PNG files with visualizations:
   - `dda_demo_results.png` - Original signals and DDA results
   - `dda_demo_preprocessing.png` - Preprocessing comparison
   - `dda_simple_demo.png` - Simple API demo visualization

## DDA Analysis Overview

DDA (Delay Differential Analysis) is used to:
- Analyze synchronization between EEG channels
- Detect phase relationships in neural signals
- Identify coupling patterns in brain activity
- Track changes in connectivity over time

The Q matrix output represents:
- Rows: Channel pairs (e.g., Ch1-Ch2, Ch1-Ch3, etc.)
- Columns: Time windows
- Values: Delay differential measurements

## Integration with DDALAB

To use DDA in the full DDALAB system:

1. **Via Web Interface**: Upload EDF files at http://localhost:3000
2. **Via API**: POST to `/api/dda` endpoint
3. **Via Python**: Use the DDAService class from DDALAB

Example API request:
```python
import requests

response = requests.post('http://localhost:8000/api/dda', json={
    'file_path': '/path/to/file.edf',
    'channel_list': [1, 2, 3, 4],
    'preprocessing_options': {
        'filter_low': 0.5,
        'filter_high': 40.0,
        'notch_filter': 50.0
    }
})
```

## Troubleshooting

1. **Import Error**: Ensure dda_py is installed in your Python environment
2. **Memory Issues**: Reduce data size or window count for large files
3. **Visualization Issues**: Check matplotlib backend settings

## Next Steps

1. Try the demos with your own EDF files
2. Explore different preprocessing parameters
3. Use the full DDALAB platform for production analysis
4. Check the API documentation for advanced features
