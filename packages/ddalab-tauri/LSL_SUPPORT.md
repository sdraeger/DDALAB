# Lab Streaming Layer (LSL) Support for DDALAB

DDALAB now includes optional support for the Lab Streaming Layer (LSL) protocol, widely used in neuroscience research for real-time data acquisition with sub-millisecond synchronization accuracy.

## Overview

LSL allows DDALAB to:
- **Discover and connect** to LSL streams on your network automatically
- **Receive real-time data** from EEG, MEG, ECG, EMG, EOG, and other physiological sensors
- **Synchronize multiple devices** with sub-millisecond timing precision
- **Process streaming data** with real-time DDA analysis

## Current Status

### Official Release Builds

✅ **LSL support is INCLUDED in ALL release builds:**
- **macOS** (Apple Silicon M1/M2/M3 and Intel x64) - Built with Xcode 15.2
- **Linux** (x86_64 and ARM64) - AppImage, Debian, RPM
- **Windows** (x64)

All release binaries from GitHub Actions have full LSL support compiled in!

### Building from Source

⚠️ **LSL support is OPTIONAL when building from source** - disabled by default due to compilation issues with Xcode 17+ on macOS. The LSL Rust crate uses older C++ code that's incompatible with the strictest modern Clang settings.

**For local development with Xcode 17+**: LSL cannot be built. Use other streaming sources or develop on Linux.
**For official releases**: GitHub Actions builds with Xcode 15.2 successfully include LSL for all macOS users!

## Using LSL in Release Builds

If you downloaded an official release:

- **All users** (macOS, Linux, Windows): LSL support is already included! Just select "Lab Streaming Layer" from the streaming source dropdown and start streaming.

## Enabling LSL Support (Building from Source)

### Option 1: Install Xcode 15.2 (macOS - If Available)

If you have Xcode 15.2 or earlier installed:

```bash
# Switch to Xcode 15.2
sudo xcode-select -s /Applications/Xcode_15.2.app/Contents/Developer

# Set compiler flags
export CMAKE_CXX_FLAGS="-Wno-error=enum-constexpr-conversion -Wno-error=deprecated-declarations -Wno-error=deprecated-builtins"
export CMAKE_C_FLAGS="-Wno-error=enum-constexpr-conversion -Wno-error=deprecated-declarations -Wno-error=deprecated-builtins"

# Build with LSL support
cd packages/ddalab-tauri/src-tauri
cargo build --features lsl-support
```

**Note**: If you only have Xcode 17+ (26.x), the LSL C++ code will not compile locally. However, all official release builds from GitHub Actions include LSL support for macOS!

### Option 2: Using Docker (Recommended for Testing)

Build and run DDALAB in a Docker container with older compiler versions:

```bash
# Create a Dockerfile with older compilers
docker build -f Dockerfile.lsl -t ddalab-lsl .
docker run -it ddalab-lsl
```

### Option 3: Using system-installed LSL (Future)

Once the LSL Rust crate is updated, you can link against a system-installed liblsl:

```bash
brew install labstreaminglayer/tap/lsl  # macOS
# or
sudo apt install liblsl-dev  # Linux
```

Then build with:

```bash
cargo build --features lsl-support
```

## Using LSL Streams

Once LSL support is enabled, you can:

### 1. Start an LSL Stream

In the DDALAB UI:
1. Navigate to **Streaming View**
2. Click **Configure Stream**
3. Select **Lab Streaming Layer** as the source type
4. Configure LSL settings:
   - **Stream Name** (optional): Specific stream name to connect to
   - **Stream Type**: EEG, MEG, ECG, EMG, EOG, Gaze, Markers, Audio, or Any
   - **Source ID** (optional): Unique stream identifier
   - **Resolution Timeout**: Time to wait for stream discovery (1-30 seconds)
   - **Chunk Size**: Number of samples to pull per iteration (100-5000)
   - **Use LSL Timestamps**: Enable for precise multi-device synchronization

### 2. LSL Stream Discovery

DDALAB automatically discovers LSL streams on your network using LSL's resolver protocol. Leave filters empty to match any available stream.

### 3. Example: Connecting to EEG Stream

```typescript
// TypeScript configuration example
const lslConfig: LslSourceConfig = {
  type: "lsl",
  stream_type: "EEG",
  resolve_timeout: 5.0,
  chunk_size: 1000,
  use_lsl_timestamps: true,
};
```

### 4. Creating Test Streams

You can create test LSL streams using Python:

```python
from pylsl import StreamInfo, StreamOutlet
import numpy as np
import time

# Create stream info
info = StreamInfo('TestEEG', 'EEG', 8, 250, 'float32', 'myuid34234')

# Create outlet
outlet = StreamOutlet(info)

# Stream data
print("Streaming test EEG data...")
while True:
    # Generate random EEG-like data (8 channels)
    sample = np.random.randn(8) * 10
    outlet.push_sample(sample)
    time.sleep(1/250)  # 250 Hz
```

## Architecture

The LSL implementation follows DDALAB's pluggable streaming architecture:

```
┌─────────────────────────────────────────────────┐
│              StreamController                    │
│  (Orchestrates data flow and DDA processing)   │
└────────────┬────────────────────────────────────┘
             │
             │ StreamSource trait
             ▼
┌─────────────────────────────────────────────────┐
│           LslStreamSource                       │
│  • Stream resolution (discovery)                │
│  • Inlet creation and management                │
│  • Chunk-based data pulling                     │
│  • Timestamp synchronization                    │
│  • Channel metadata extraction                  │
└─────────────────────────────────────────────────┘
             │
             │ LSL Protocol
             ▼
┌─────────────────────────────────────────────────┐
│        Lab Streaming Layer Network              │
│  • EEG/MEG/ECG/EMG devices                      │
│  • Behavioral markers                           │
│  • Eye trackers                                 │
│  • Audio streams                                │
└─────────────────────────────────────────────────┘
```

## Implementation Details

### Files Created/Modified

1. **`src-tauri/src/streaming/source/lsl.rs`** - LSL source implementation
   - Stream resolution with predicates
   - Inlet creation and configuration
   - Chunk-based sample pulling
   - Channel name extraction from XML metadata
   - Timestamp handling (LSL synchronized or local)

2. **`src-tauri/src/streaming/source/mod.rs`** - Updated with LSL variant
   - `StreamSourceConfig::LslStream` enum variant
   - Factory registration
   - Feature-gated compilation

3. **`src/types/streaming.ts`** - Frontend TypeScript types
   - `LslSourceConfig` interface
   - Updated type unions

4. **`src/components/streaming/StreamConfigDialog.tsx`** - UI configuration
   - LSL configuration panel
   - Stream type selection
   - Discovery timeout controls

### Key Features

- **Automatic Discovery**: Uses LSL resolver with XPath-based predicates
- **Flexible Filtering**: Match by name, type, or source ID
- **Time Synchronization**: Optional LSL synchronized timestamps
- **Channel Metadata**: Extracts channel names from LSL XML metadata
- **Error Handling**: Robust connection and recovery logic
- **Efficient Buffering**: Configurable chunk sizes for optimal throughput

## Troubleshooting

### "No LSL stream found matching criteria"

- Ensure LSL streams are running on your network
- Increase the resolution timeout
- Try removing filters (leave name/type/source_id empty)
- Check network connectivity and firewall settings

### "LSL support is not available"

- LSL support was not enabled during compilation
- Rebuild with `--features lsl-support` flag
- Check compiler compatibility (Clang < 17 required)

### Compilation Errors on macOS with Xcode 17+

The current LSL Rust crate (v0.1.1) has compatibility issues with Xcode 17+:
- Error: `integer value -1 is outside the valid range`
- Error: `'unary_function' is deprecated`

**Solution ✅**:
Use Xcode 15.2 or earlier with compiler flags:
```bash
export CXXFLAGS="-Wno-error=enum-constexpr-conversion -Wno-error=deprecated-declarations"
export CFLAGS="-Wno-error=enum-constexpr-conversion -Wno-error=deprecated-declarations"
cargo build --features lsl-support
```

This is proven to work in our CI/CD pipeline!

## Performance Considerations

- **Chunk Size**: Larger chunks = higher throughput but more latency
  - Recommended: 1000 samples for balanced performance
  - Low latency: 100-500 samples
  - High throughput: 2000-5000 samples

- **Timestamps**: LSL synchronized timestamps add minimal overhead (~0.1ms) but provide accurate cross-device sync

- **Network**: LSL uses TCP for reliability. For best performance:
  - Use wired connections when possible
  - Minimize network hops between devices
  - Ensure sufficient bandwidth (typically < 1 Mbps for most streams)

## GitHub Actions CI/CD

The GitHub Actions release workflow automatically enables LSL for **all platforms**:

### 1. Platform Configuration

```yaml
- platform: 'macos-13'     # Use older runner with Xcode 15.2
  lsl_support: true        # ✅ Enabled
  xcode_version: '15.2'    # Explicitly select compatible Xcode

- platform: 'ubuntu-22.04'
  lsl_support: true        # ✅ Enabled

- platform: 'windows-latest'
  lsl_support: true        # ✅ Enabled
```

### 2. macOS LSL Build Configuration

For macOS, the workflow:

**a) Selects Xcode 15.2:**
```bash
sudo xcode-select -s /Applications/Xcode_15.2.app/Contents/Developer
```

**b) Sets compiler flags to allow LSL compilation:**
```bash
export CXXFLAGS="-Wno-error=enum-constexpr-conversion -Wno-error=deprecated-declarations"
export CFLAGS="-Wno-error=enum-constexpr-conversion -Wno-error=deprecated-declarations"
```

These flags disable the specific warnings that Xcode 17+ treats as errors, allowing the LSL C++ code to compile successfully.

### 3. LSL Dependencies Installation

- **Linux**: CMake and build-essential via apt
- **Windows**: CMake via lukka/get-cmake action
- **macOS**: Uses system CMake (included with Xcode)

### 4. Feature Flag

All platforms build with:
```bash
cargo build --features lsl-support
```

### 5. Future-Proofing

⚠️ **Note**: `macos-13` runners will be deprecated in December 2025. Before then, we need to either:
- Update the LSL Rust crate to support Xcode 17+, or
- Migrate to `macos-14` with Xcode 15.x using compiler flags

## Future Enhancements

- [x] ~~Enable LSL for macOS~~ ✅ **DONE** - Now supported via Xcode 15.2!
- [ ] Migrate to macos-14 runners before macos-13 deprecation (Dec 2025)
- [ ] Update to newer LSL Rust bindings when available
- [ ] Add LSL stream browsing UI (list all available streams)
- [ ] Support for LSL metadata queries
- [ ] LSL stream recording to XDF format
- [ ] Multi-stream synchronization
- [ ] LSL marker stream integration with annotations

## Resources

- [LSL Documentation](https://labstreaminglayer.readthedocs.io/)
- [LSL GitHub](https://github.com/sccn/labstreaminglayer)
- [LSL Rust Bindings](https://github.com/labstreaminglayer/liblsl-rust)
- [XDF File Format](https://github.com/sccn/xdf)

## Contributing

If you successfully compile LSL support on your platform or have workarounds for the compilation issues, please share:
- Platform/OS version
- Compiler version
- Build commands used
- Any necessary patches

Open an issue or PR on the DDALAB GitHub repository.
