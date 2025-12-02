# dda-py

Python bindings for DDA (Delay Differential Analysis).

The [DDA binary](https://snl.salk.edu/~sfdraeger/dda/) is required. Please download the most recent version from the file server.

## Installation

```bash
pip install dda-py
```

## Usage

```python
from dda_py import DDARequest, DDARunner, ST, generate_select_mask

# Create a DDA request
request = DDARequest(
    input_file="data.edf",
    output_file="results.dda",
    select_mask=generate_select_mask([ST]),  # Select ST variant
)

# Run DDA
runner = DDARunner(binary_path="run_DDA_AsciiEdf")
result = runner.run(request)
```

## Variants

The package provides access to all DDA variants:

- `ST` - Single Timeseries
- `CT` - Cross Timeseries
- `CD` - Cross Dynamical
- `DE` - Dynamical Ergodicity
- `SY` - Synchrony

## License

MIT
