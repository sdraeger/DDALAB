# DDALAB Architecture Diagrams

This directory contains architecture diagrams for the DDALAB system, available in multiple formats.

## Files

- `architecture_diagram.tex` - Detailed TikZ/LaTeX diagram (publication quality)
- `architecture_simple.tex` - Simplified version for embedding in papers
- `architecture_diagram.mmd` - Mermaid diagram (easy to view/edit online)
- `build_diagram.sh` - Build script for LaTeX diagrams

## Quick View Options

### Option 1: View Mermaid Diagram Online (Easiest)

1. Open https://mermaid.live/
2. Copy the contents of `architecture_diagram.mmd`
3. Paste into the online editor
4. View and export as PNG/SVG

### Option 2: Render with Node.js

```bash
# Install mermaid-cli
npm install -g @mermaid-js/mermaid-cli

# Generate PNG (default)
mmdc -i architecture_diagram.mmd -o architecture_diagram.png

# Generate SVG (vector, publication quality)
mmdc -i architecture_diagram.mmd -o architecture_diagram.svg

# Generate high-resolution PNG
mmdc -i architecture_diagram.mmd -o architecture_diagram.png -w 2400 -H 1800
```

### Option 3: Build LaTeX Diagram (Best Quality)

Requirements:
- LaTeX distribution (MacTeX, TeX Live, or MiKTeX)
- ImageMagick (optional, for PNG conversion)

```bash
# On macOS
brew install --cask mactex
brew install imagemagick

# On Ubuntu/Debian
sudo apt install texlive-full imagemagick

# Build the diagram
cd docs
./build_diagram.sh
```

## Using in Your Paper

### For LaTeX Papers

Add to your preamble:
```latex
\usepackage{tikz}
\usetikzlibrary{shapes.geometric, arrows.meta, positioning, fit, backgrounds, shadows}
```

Then include the diagram:
```latex
\input{docs/architecture_simple.tex}
```

Or for the detailed version:
```latex
\begin{figure}[htbp]
\centering
\includegraphics[width=\textwidth]{docs/architecture_diagram.pdf}
\caption{DDALAB system architecture.}
\label{fig:architecture}
\end{figure}
```

### For Word/Google Docs

1. Generate PNG using Mermaid or LaTeX
2. Insert as image

## Diagram Description

The diagrams illustrate DDALAB's hybrid architecture with two deployment modes:

### Standalone Desktop Deployment (Left Side)
- **Tauri Desktop App**: React/TypeScript UI
- **Embedded Rust API**: Built-in Axum web server (localhost:8765)
- **Custom EDF Reader**: Rust implementation for accurate EDF parsing
- **DDA Binary Executor**: Direct execution of DDA analysis
- **Local Filesystem**: All data stays on user's computer

**Features**: Zero configuration, complete data privacy, no dependencies, instant startup

### Institutional Deployment (Right Side)
- **Tauri Desktop App**: Same UI as standalone
- **Traefik**: SSL/TLS reverse proxy and load balancer
- **FastAPI Server**: Python-based API with GraphQL
- **PostgreSQL**: Persistent data storage
- **Redis**: Caching and session management
- **MinIO**: Object storage for large EEG files
- **dda_py**: Python package for DDA analysis

**Features**: Centralized deployment, multi-user support, shared storage, scalability

### Common Capabilities
Both modes share:
- Custom EDF file reader (correct duration calculation)
- DDA analysis with multiple algorithm variants
- Real-time visualization
- State persistence across sessions
- Cross-platform support (Windows, macOS, Linux)

## Color Scheme

- **Orange (#FFC706)**: Tauri framework
- **Rust Orange (#CE5C00)**: Rust components
- **Blue (#00B6FF)**: Docker infrastructure
- **Teal (#009688)**: FastAPI services
- **Gray**: Storage/file systems

## Editing the Diagrams

### Mermaid Diagram
Edit `architecture_diagram.mmd` in any text editor. Syntax documentation: https://mermaid.js.org/

### LaTeX/TikZ Diagrams
Edit `architecture_diagram.tex` or `architecture_simple.tex`. TikZ documentation: https://tikz.dev/

## Export Formats

- **PDF**: Best for LaTeX papers (vector, scalable)
- **SVG**: Best for web/presentations (vector, scalable)
- **PNG**: Best for Word/PowerPoint (raster, specify high DPI)

## Troubleshooting

### LaTeX build fails
- Ensure all required packages are installed: `tlmgr install standalone tikz pgf`
- Check LaTeX log files for missing packages

### Mermaid rendering fails
- Check syntax at https://mermaid.live/
- Ensure Node.js is up to date: `node --version` (should be v14+)

### ImageMagick conversion fails
- Check ImageMagick policy: `/etc/ImageMagick-*/policy.xml`
- May need to enable PDF conversion in policy file

## License

These diagrams are part of the DDALAB project. See main LICENSE file.
