# DDALAB App Icon

This directory contains the app icons for DDALAB (Delay Differential Analysis Laboratory).

## Design Description

The icon features:

- A brain symbol in the center (matching the header Brain icon from Lucide React)
- Deep blue gradient background (#1e40af to #0f172a) for good contrast
- White/light gray brain with subtle details and stroke
- 512x512 base resolution for crisp scaling
- Professional, scientific appearance suitable for a medical/research application

## Required Formats

Based on tauri.conf.json, the following PNG files are needed:

- `32x32.png` - Small icon for taskbar/system tray
- `128x128.png` - Standard desktop icon
- `128x128@2x.png` - High-DPI version (actually 256x256)

## Converting from SVG

To convert the brain-icon.svg to the required PNG formats:

1. Use a tool like Inkscape, GIMP, or an online SVG to PNG converter
2. Export at the following sizes:
   - 32x32 pixels → save as `32x32.png`
   - 128x128 pixels → save as `128x128.png`
   - 256x256 pixels → save as `128x128@2x.png`

Or use command line tools:

```bash
# Using ImageMagick (if available)
convert brain-icon.svg -resize 32x32 32x32.png
convert brain-icon.svg -resize 128x128 128x128.png
convert brain-icon.svg -resize 256x256 128x128@2x.png
```

## Icon Details

The brain icon is based on the Lucide React Brain component used in the app header, scaled and styled appropriately for an app icon with:

- High contrast for visibility at small sizes
- Professional color scheme matching the app's theme
- Clean, modern design suitable for desktop applications
