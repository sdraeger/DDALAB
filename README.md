# DDALAB - Delay Differential Analysis Laboratory

DDALAB is a desktop application for performing Delay Differential Analysis (DDA) on EDF and ASCII files. Built with Tauri and React, it provides a native desktop experience with powerful analysis capabilities while keeping all data processing local to your machine for maximum privacy.

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

- **Native Desktop App**: Fast, responsive interface built with Tauri
- **Embedded Rust API**: High-performance local analysis with no external dependencies
- **Docker API Option**: Alternative backend using Docker containers (for advanced users)
- **Complete Privacy**: All data processing happens on your local machine
- **EDF File Support**: Native support for European Data Format files
- **Real-time Analysis**: View DDA results with interactive heatmaps and plots
- **Analysis History**: Persistent storage of previous analyses for easy comparison

## Architecture

DDALAB offers two API backend options:

### 1. Embedded Rust API (Default, Recommended)

The embedded Rust API runs directly within the Tauri application, providing:

- Zero setup required
- No external dependencies
- Fast startup time
- Native performance
- Complete offline functionality

This is the **recommended** approach for most users.

### 2. Docker API Backend (Advanced)

For users who prefer the Docker-based architecture, DDALAB can connect to a separate API container:

```bash
# Start API backend only
docker-compose -f docker-compose.api-only.yml up -d

# Configure DDALAB to use Docker API
# Settings → API Backend → Docker (http://localhost:8001)
```

The Docker backend includes:

- Python FastAPI server
- PostgreSQL database
- Redis cache
- MinIO object storage
- Full web interface at https://localhost

## Quick Start

1. **Launch DDALAB** from your Applications folder (macOS), Start menu (Windows), or application launcher (Linux)

2. **Select Data Directory**: Choose where your EDF files are located

3. **Load EDF File**: Click "Browse Files" and select an EDF file to analyze

4. **Configure Analysis**:
   - Select channels to analyze
   - Set window parameters (length, step size)
   - Choose scale range (delay parameters)

5. **Run Analysis**: Click "Run DDA Analysis" and view results in real-time

6. **View Results**: Interactive heatmaps and line plots show complexity across time and scales

## Development

### Prerequisites

- **Rust**: Install from [rustup.rs](https://rustup.rs/)
- **Node.js**: Version 18+ ([nodejs.org](https://nodejs.org/))
- **npm**: Comes with Node.js
- **DDA Binary**: Place `run_DDA_ASCII` in `bin/` directory (see grant report for details)

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
│   └── ddalab-tauri/          # Tauri desktop application
│       ├── src/               # React frontend
│       ├── src-tauri/         # Rust backend
│       │   ├── src/
│       │   │   ├── embedded_api.rs    # Embedded Rust API
│       │   │   ├── edf.rs             # EDF file reader
│       │   │   └── commands/          # Tauri commands
│       │   └── Cargo.toml
│       └── package.json
├── bin/                       # DDA binary executables
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

- **Tauri**: Desktop app framework (Rust + WebView)
- **React**: UI framework with TypeScript
- **Axum**: High-performance Rust web framework for embedded API
- **Next.js**: React framework for frontend
- **uPlot**: Fast, lightweight plotting library
- **Tailwind CSS**: Utility-first CSS framework

## Docker-based Deployment (Optional)

For users who want to deploy DDALAB as a web service:

```bash
# 1. Clone repository
git clone https://github.com/sdraeger/DDALAB.git
cd DDALAB

# 2. Configure environment
cp .env.production.example .env
nano .env  # Update passwords and settings

# 3. Start full stack
docker-compose up -d

# 4. Access web interface
# Open https://localhost in your browser
```

This deployment includes:

- Python FastAPI backend
- PostgreSQL database
- Redis cache
- MinIO object storage (for EDF files)
- Traefik reverse proxy with SSL
- Web interface for remote access

### Docker Services

- **API Server**: http://localhost:8001 (direct) or https://localhost/api (via Traefik)
- **Web Interface**: https://localhost
- **MinIO Console**: http://localhost:9001
- **Traefik Dashboard**: https://localhost:8080

To stop: `docker-compose down`

## DDALAB Launcher (CLI Tool)

For managing Docker deployments, use the DDALAB Launcher:

```bash
# Clone launcher
git clone https://github.com/sdraeger/DDALAB-launcher.git
cd DDALAB-launcher

# Build and run
make build
./bin/ddalab-launcher
```

Features:

- Auto-detection of DDALAB installations
- Interactive menu for all operations
- Status monitoring and log viewing
- Cross-platform support

## Configuration

### Embedded API Settings

The embedded Rust API stores data in:

- **macOS**: `~/Library/Application Support/ddalab`
- **Windows**: `%APPDATA%/ddalab`
- **Linux**: `~/.local/share/ddalab`

Configuration includes:

- Data directory path
- Analysis history
- Application preferences

### Docker API Settings

For Docker deployments, edit `.env` file to configure:

- Database credentials
- MinIO storage settings
- SSL certificates
- Port mappings

## SSL Certificates

For Docker deployments with Traefik:

```bash
# Generate self-signed certificate
openssl genrsa -out certs/server.key 2048
openssl req -new -key certs/server.key -out certs/server.csr
openssl x509 -req -days 365 -in certs/server.csr -signkey certs/server.key -out certs/server.crt
```

For production deployments, use proper SSL certificates from Let's Encrypt or your certificate authority.

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

1. Verify DDA binary is present:
   - macOS/Linux: Check `~/.local/bin/run_DDA_ASCII` or system PATH
   - Windows: Check application directory for `run_DDA_ASCII.exe`

2. Check file permissions:

   ```bash
   chmod +x /path/to/run_DDA_ASCII
   ```

3. View logs in Settings → Debug Information

### Docker deployment issues

```bash
# Check logs
docker-compose logs

# Specific service logs
docker-compose logs api

# Restart services
docker-compose restart

# Clean restart
docker-compose down
docker-compose up -d
```

## API Documentation

When using Docker deployment, API documentation is available at:

- **Swagger UI**: https://localhost/api/docs
- **ReDoc**: https://localhost/api/redoc
- **GraphQL Playground**: https://localhost/graphql

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details.

## Citation

If you use DDALAB in your research, please cite:

```bibtex
@software{ddalab2024,
  author = {Draeger, Simon},
  title = {DDALAB: Delay Differential Analysis Laboratory},
  year = {2024},
  url = {https://github.com/sdraeger/DDALAB}
}
```

## Acknowledgments

DDALAB was developed as part of an NIH research grant to provide accessible tools for delay differential analysis of physiological signals.

## Support

- **Issues**: [GitHub Issues](https://github.com/sdraeger/DDALAB/issues)
- **Documentation**: [docs/](docs/)

## Related Projects

- **DDALAB Launcher**: CLI tool for managing DDALAB installations
- **DDA Binary**: Core analysis engine (contact for access)

---

**Note**: This is an open-source scientific tool. While it has been tested extensively, always validate results against known standards for your specific use case.
