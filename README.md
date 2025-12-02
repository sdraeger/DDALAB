# DDALAB - Delay Differential Analysis Laboratory

DDALAB is a desktop application for performing Delay Differential Analysis (DDA) on neurophysiological data. Built with Tauri and React with a high-performance Rust backend, it provides a native desktop experience with powerful analysis capabilities while keeping all data processing local to your machine for maximum privacy.

## Download & Installation

### macOS

1. Download the latest `.dmg` file from [Releases](https://github.com/sdraeger/DDALAB/releases)
2. Open the `.dmg` file and drag DDALAB to your Applications folder
3. **Important**: macOS will block unsigned applications. To run DDALAB, execute this command in Terminal:

   ```bash
   sudo xattr -r -d com.apple.quarantine /Applications/DDALAB.app
   ```

   This is necessary because DDALAB is not signed with a paid Apple Developer license. Your data remains private and secure - all processing happens locally on your machine.

4. Launch DDALAB from Applications

### Windows

1. Download the latest `.msi` installer from [Releases](https://github.com/sdraeger/DDALAB/releases)
2. Run the installer and follow the setup wizard
3. Launch DDALAB from the Start menu

### Linux

1. Download the latest `.AppImage` or `.deb` package from [Releases](https://github.com/sdraeger/DDALAB/releases)
2. For AppImage:
   ```bash
   chmod +x DDALAB-*.AppImage
   ./DDALAB-*.AppImage
   ```
3. For Debian/Ubuntu (.deb):
   ```bash
   sudo dpkg -i DDALAB-*.deb
   sudo apt-get install -f  # Install dependencies if needed
   ```

## Features

- **Native Desktop App**: Fast, responsive interface built with Tauri and React
- **High-Performance Rust Backend**: Embedded Rust API with no external dependencies
- **Multiple File Formats**: Support for EDF, FIFF (.fif), ASCII/TXT, CSV, BrainVision (.vhdr), and EEGLAB (.set) files
- **BIDS Compatibility**: Native support for Brain Imaging Data Structure (BIDS) datasets
- **OpenNeuro Integration**: Browse and download datasets directly from OpenNeuro.org
- **Complete Privacy**: All data processing happens locally on your machine
- **Real-time Analysis**: Interactive heatmaps and time-series plots with ECharts
- **Multi-Variant DDA**: Support for both classic DDA and CT (cross-timeseries) variants
- **Analysis History**: Persistent storage of analyses with SQLite database
- **Optional Sync Broker**: Deploy a network sync broker for multi-user collaboration

## Architecture

DDALAB is built with a modern, high-performance architecture:

### Core Application

The desktop application uses:

- **Tauri v2**: Lightweight desktop framework with native OS integration
- **React + Next.js**: Modern frontend with TypeScript
- **Embedded Rust API**: High-performance local backend using Axum web framework
- **SQLite Database**: Local storage for analysis history and state persistence
- **ECharts**: Interactive, hardware-accelerated plotting
- **TanStack Query**: Efficient data fetching and caching

All data processing happens **locally** within the application with:

- Zero external dependencies
- No internet connection required
- Complete data privacy
- Fast startup and native performance

### Optional Network Deployment

For multi-user environments or centralized deployments, DDALAB supports:

1. **Sync Broker** (Rust): Lightweight synchronization service for sharing analyses across users
2. **Network API Server**: Deploy a single shared API server for multiple clients

```bash
# Deploy sync broker
cd packages/ddalab-broker
docker-compose up -d

# Or deploy full network stack
docker-compose up -d
```

## Quick Start

1. **Launch DDALAB** from your Applications folder (macOS), Start menu (Windows), or application launcher (Linux)

2. **Select Data Directory**: Choose where your data files are located

3. **Load a File**:

   - Browse local files (EDF, FIFF, ASCII, CSV, BrainVision, EEGLAB)
   - Or open a BIDS dataset
   - Or download from OpenNeuro

4. **Configure Analysis**:

   - Select channels to analyze
   - Set window parameters (length, step size, overlap)
   - Choose DDA variant (classic or CT)
   - Set delay range and parameters

5. **Run Analysis**: Click "Run DDA Analysis" and monitor progress in real-time

6. **View Results**:
   - Interactive heatmaps show complexity across time and delays
   - Time-series plots display signal data
   - Export results for further analysis

## Updating DDALAB

DDALAB includes a built-in update checker to help you stay current with the latest features and bug fixes.

### Manual Update Check

1. Open DDALAB
2. Navigate to **Settings** (gear icon)
3. Scroll to the **Software Updates** section
4. Click **Check for Updates**
5. If an update is available, click **Download Update** to open the GitHub releases page
6. Download and install the latest version for your platform

The update checker will:

- Display your current version
- Compare with the latest GitHub release
- Show release notes and release date
- Provide a direct download link

**Note**: Updates are not installed automatically. You must manually download and install new versions.

## Development

### Prerequisites

- **Rust**: Install from [rustup.rs](https://rustup.rs/) (requires 1.70+)
- **Node.js**: Version 18+ ([nodejs.org](https://nodejs.org/))
- **npm**: Comes with Node.js
- **System Dependencies**:
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Linux: `build-essential`, `libssl-dev`, `libgtk-3-dev`, `libwebkit2gtk-4.0-dev`
  - Windows: MSVC toolchain via Visual Studio

### Getting Started

```bash
# Clone the repository
git clone https://github.com/sdraeger/DDALAB.git
cd DDALAB

# Install dependencies
npm install

# Run Tauri app in development mode
cd packages/ddalab-tauri
npm run tauri:dev
```

### Project Structure

```
DDALAB/
├── packages/
│   ├── ddalab-tauri/          # Main Tauri desktop application
│   │   ├── src/               # React + Next.js frontend
│   │   │   ├── components/    # UI components
│   │   │   ├── hooks/         # React hooks & TanStack Query
│   │   │   ├── services/      # API services & BIDS reader
│   │   │   └── store/         # Zustand state management
│   │   ├── src-tauri/         # Rust backend
│   │   │   ├── src/
│   │   │   │   ├── embedded_api.rs      # Axum web server
│   │   │   │   ├── file_readers/        # Multi-format file readers
│   │   │   │   ├── commands/            # Tauri IPC commands
│   │   │   │   ├── db/                  # SQLite database layer
│   │   │   │   └── state_manager.rs     # State persistence
│   │   │   └── Cargo.toml
│   │   └── package.json
│   ├── ddalab-broker/         # Optional sync broker (Rust)
│   └── dda-rs/                # DDA analysis engine (Rust)
├── docs/                      # Documentation
└── README.md
```

### Building for Production

```bash
# Build for your current platform
cd packages/ddalab-tauri
npm run tauri build

# Outputs will be in src-tauri/target/release/bundle/
```

### Key Technologies

**Frontend:**

- **Tauri v2**: Desktop app framework with native OS integration
- **React 18**: UI library with TypeScript
- **Next.js 14**: React framework with App Router
- **TanStack Query**: Data fetching, caching, and synchronization
- **Zustand**: Lightweight state management
- **ECharts**: Hardware-accelerated interactive charts
- **Radix UI**: Accessible component primitives
- **Tailwind CSS**: Utility-first styling

**Backend:**

- **Rust**: Systems programming language for performance and safety
- **Axum**: High-performance async web framework
- **SQLite**: Embedded database via rusqlite
- **Tokio**: Async runtime
- **Serde**: Serialization/deserialization
- **DDA-RS**: Custom Rust implementation of DDA algorithms

## Network Deployment (Optional)

For multi-user environments or centralized deployments:

### Sync Broker Deployment

Deploy a lightweight sync broker for sharing analyses across users:

```bash
cd packages/ddalab-broker
docker-compose up -d
```

The sync broker provides:

- Real-time synchronization of analysis results
- Centralized storage of shared analyses
- Minimal resource requirements
- No database dependencies

### Network API Server

Deploy a shared API server for multiple DDALAB clients:

```bash
# Configure environment
cp .env.example .env

# Start services
docker-compose up -d
```

This includes:

- Rust-based API server
- Optional PostgreSQL for shared storage
- Optional Redis for caching
- Web interface at http://localhost:8001

Client configuration:

1. Open DDALAB Settings
2. Set API endpoint to `http://your-server:8001`
3. Enable network mode

## Configuration

### Application Data Storage

DDALAB stores all data locally in platform-specific directories:

- **macOS**: `~/Library/Application Support/ddalab/`
- **Windows**: `%APPDATA%\ddalab\`
- **Linux**: `~/.local/share/ddalab/`

Stored data includes:

- **ddalab.db**: SQLite database with analysis history and metadata
- **state.json**: Application state and preferences
- **config.json**: User configuration settings
- **logs/**: Application logs for debugging

### User Preferences

Accessible via Settings panel:

- Data directory path
- DDA analysis parameters (window size, overlap, delay range)
- UI preferences (theme, layout)
- API endpoint (for network mode)
- OpenNeuro API key (for dataset uploads)

### Network Deployment Configuration

For network deployments, configure via `.env`:

```bash
# API Server
API_PORT=8001
API_HOST=0.0.0.0

# Database (optional)
DATABASE_URL=postgresql://user:pass@localhost/ddalab

# Redis (optional)
REDIS_URL=redis://localhost:6379
```

## Troubleshooting

### macOS: "App is damaged and can't be opened"

This is due to Apple's Gatekeeper. Run:

```bash
sudo xattr -r -d com.apple.quarantine /Applications/DDALAB.app
```

### Windows: "Windows protected your PC"

Click "More info" → "Run anyway". This message appears because the app is not signed with an EV certificate.

### Linux: AppImage won't run

Make sure it's executable:

```bash
chmod +x DDALAB-*.AppImage
```

### Analysis fails to run

1. **Check DDA binary**: Ensure the `dda-rs` Rust library is properly compiled

   - Development: Run `cargo build` in `packages/dda-rs/`
   - Production: Binary is bundled with the application

2. **Check file format**: Verify your file is in a supported format:

   - EDF (European Data Format)
   - FIFF (.fif - Neuromag/Elekta MEG format)
   - ASCII/TXT (tab or comma-separated)
   - CSV (comma-separated values)
   - BrainVision (.vhdr with .eeg/.dat)
   - EEGLAB (.set with .fdt)

3. **View logs**: Settings → Debug Information → View Logs

4. **Check file permissions**: Ensure DDALAB has read access to your data directory

### Application won't start

1. Check system requirements (Rust 1.70+, Node 18+)
2. Clear application data (backup first!):
   - macOS: `rm -rf ~/Library/Application\ Support/ddalab/`
   - Windows: Delete `%APPDATA%\ddalab\`
   - Linux: `rm -rf ~/.local/share/ddalab/`
3. Reinstall the application

### Network deployment issues

```bash
# Check broker logs
cd packages/ddalab-broker
docker-compose logs -f

# Check API server logs
docker-compose logs -f api

# Restart services
docker-compose restart

# Clean restart
docker-compose down -v
docker-compose up -d
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details.

## Citation

If you use DDALAB in your research, please cite:

```bibtex
@software{draeger-ddalab-2025,
  author = {Dr\"ager, Simon and Lainscsek, Claudia and Sejnowski, Terrence J},
  title = {DDALAB: Delay Differential Analysis Laboratory},
  year = {2025},
  url = {https://github.com/sdraeger/DDALAB}
}
```

## Acknowledgments

DDALAB was developed as part of an NIH research grant to provide accessible tools for delay differential analysis of physiological signals.

## Support

- **Issues**: [GitHub Issues](https://github.com/sdraeger/DDALAB/issues)
- **Documentation**: [docs/](docs/)

## Related Projects

- **DDA-RS**: Rust implementation of Delay Differential Analysis algorithms
- **DDALAB Broker**: Lightweight synchronization service for multi-user environments

---

**Note**: This is an open-source scientific tool developed for research purposes. While it has been tested extensively, always validate results against known standards for your specific use case.
