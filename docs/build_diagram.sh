#!/bin/bash
# Build script for DDALAB architecture diagrams

set -e

echo "Building DDALAB architecture diagrams..."

# Find pdflatex
PDFLATEX=$(which pdflatex 2>/dev/null || find /usr/local/texlive /Library/TeX -name pdflatex 2>/dev/null | head -1)

if [ -z "$PDFLATEX" ]; then
    echo "Error: pdflatex not found. Please install LaTeX (e.g., texlive or mactex)"
    exit 1
fi

echo "Using pdflatex: $PDFLATEX"

# Build the detailed diagram
echo "Building detailed architecture diagram..."
"$PDFLATEX" -interaction=nonstopmode architecture_diagram.tex > /dev/null 2>&1
"$PDFLATEX" -interaction=nonstopmode architecture_diagram.tex > /dev/null 2>&1

# Convert to PNG if sips is available (macOS native tool)
if command -v sips &> /dev/null; then
    echo "Converting to PNG using macOS sips..."
    sips -s format png architecture_diagram.pdf --out architecture_diagram.png > /dev/null 2>&1
    echo "✓ Created architecture_diagram.png"
elif command -v magick &> /dev/null || command -v convert &> /dev/null; then
    echo "⚠ ImageMagick found but Ghostscript may not be configured properly"
    echo "  You can manually convert with Preview.app:"
    echo "  1. Open architecture_diagram.pdf in Preview"
    echo "  2. File > Export > Format: PNG"
elif command -v pdftoppm &> /dev/null; then
    echo "Converting to PNG using pdftoppm..."
    pdftoppm -png -r 300 architecture_diagram.pdf architecture > /dev/null 2>&1
    mv architecture-1.png architecture_diagram.png 2>/dev/null
    echo "✓ Created architecture_diagram.png"
else
    echo "⚠ No PNG converter found - PDF only"
    echo "  You can manually convert with Preview.app or install:"
    echo "    brew install poppler (for pdftoppm)"
fi

# Clean up auxiliary files
rm -f *.aux *.log *.out

echo "✓ Created architecture_diagram.pdf"
echo ""
echo "Done! Diagrams created:"
echo "  - architecture_diagram.pdf (detailed version)"
if command -v convert &> /dev/null; then
    echo "  - architecture_diagram.png (high-res)"
fi
echo ""
echo "To use in your paper, add to preamble:"
echo "  \\usepackage{tikz}"
echo "  \\usetikzlibrary{shapes.geometric, arrows.meta, positioning, fit, backgrounds, shadows}"
echo ""
echo "Then include with:"
echo "  \\input{docs/architecture_simple.tex}"
