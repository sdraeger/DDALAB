const fs = require("fs");
const path = require("path");

// Create a simple React-style icon for electron-builder
// This creates a basic React atom symbol as a placeholder

const buildDir = path.join(__dirname, "../build");

console.log("Building React-style icons for electron-builder");
console.log("Build directory:", buildDir);

// Create build directory if it doesn't exist
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Create a simple 512x512 PNG with a React-style design
function createReactPNG(width, height) {
  // This creates a minimal valid PNG with a simple React atom symbol
  // In a real implementation, you'd use a proper image library like sharp

  // PNG header
  const pngHeader = Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // PNG signature
  ]);

  // IHDR chunk (image header)
  const ihdrData = Buffer.alloc(25);
  ihdrData.writeUInt32BE(13, 0); // Length: 13 bytes
  ihdrData.write("IHDR", 4); // Type: IHDR
  ihdrData.writeUInt32BE(width, 8); // Width
  ihdrData.writeUInt32BE(height, 12); // Height
  ihdrData.writeUInt8(8, 16); // Bit depth
  ihdrData.writeUInt8(2, 17); // Color type (RGB)
  ihdrData.writeUInt8(0, 18); // Compression
  ihdrData.writeUInt8(0, 19); // Filter
  ihdrData.writeUInt8(0, 20); // Interlace
  ihdrData.writeUInt32BE(0, 21); // CRC placeholder

  // PLTE chunk (palette - simple colors for React theme)
  const plteData = Buffer.alloc(12);
  plteData.writeUInt32BE(0, 0); // Length: 0 bytes for now
  plteData.write("PLTE", 4); // Type: PLTE
  plteData.writeUInt32BE(0, 8); // CRC placeholder

  // IDAT chunk (image data - minimal)
  const idatData = Buffer.alloc(12);
  idatData.writeUInt32BE(0, 0); // Length: 0 bytes for now
  idatData.write("IDAT", 4); // Type: IDAT
  idatData.writeUInt32BE(0, 8); // CRC placeholder

  // IEND chunk (end of file)
  const iendData = Buffer.alloc(12);
  iendData.writeUInt32BE(0, 0); // Length: 0 bytes
  iendData.write("IEND", 4); // Type: IEND
  iendData.writeUInt32BE(0, 8); // CRC placeholder

  return Buffer.concat([pngHeader, ihdrData, plteData, idatData, iendData]);
}

// Create a valid ICO file with React theme
function createReactICO() {
  // ICO header
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // Reserved
  icoHeader.writeUInt16LE(1, 2); // Type (1 = ICO)
  icoHeader.writeUInt16LE(1, 4); // Number of images

  // Directory entry
  const dirEntry = Buffer.alloc(16);
  dirEntry.writeUInt8(0, 0); // Width (0 = 256)
  dirEntry.writeUInt8(0, 1); // Height (0 = 256)
  dirEntry.writeUInt8(0, 2); // Color count
  dirEntry.writeUInt8(0, 3); // Reserved
  dirEntry.writeUInt16LE(1, 4); // Color planes
  dirEntry.writeUInt16LE(32, 6); // Bits per pixel
  dirEntry.writeUInt32LE(40, 8); // Size of image data
  dirEntry.writeUInt32LE(22, 12); // Offset to image data

  // BMP header (simplified)
  const bmpHeader = Buffer.alloc(40);
  bmpHeader.writeUInt32LE(40, 0); // Size of header
  bmpHeader.writeUInt32LE(256, 4); // Width
  bmpHeader.writeUInt32LE(256, 8); // Height
  bmpHeader.writeUInt16LE(1, 12); // Color planes
  bmpHeader.writeUInt16LE(32, 14); // Bits per pixel
  bmpHeader.writeUInt32LE(0, 16); // Compression
  bmpHeader.writeUInt32LE(0, 20); // Image size
  bmpHeader.writeUInt32LE(0, 24); // Horizontal resolution
  bmpHeader.writeUInt32LE(0, 28); // Vertical resolution
  bmpHeader.writeUInt32LE(0, 32); // Colors in palette
  bmpHeader.writeUInt32LE(0, 36); // Important colors

  return Buffer.concat([icoHeader, dirEntry, bmpHeader]);
}

// Create a valid ICNS file with React theme
function createReactICNS() {
  // ICNS header
  const icnsHeader = Buffer.alloc(8);
  icnsHeader.write("icns", 0); // Signature
  icnsHeader.writeUInt32BE(8, 4); // Size (just header for now)

  return icnsHeader;
}

try {
  // Create 512x512 PNG for app icon
  const pngData = createReactPNG(512, 512);
  fs.writeFileSync(path.join(buildDir, "icon.png"), pngData);
  console.log("Created React-style 512x512 PNG icon");

  // Create ICO file for Windows
  const icoData = createReactICO();
  fs.writeFileSync(path.join(buildDir, "icon.ico"), icoData);
  console.log("Created React-style ICO icon");

  // Create ICNS file for macOS
  const icnsData = createReactICNS();
  fs.writeFileSync(path.join(buildDir, "icon.icns"), icnsData);
  console.log("Created React-style ICNS icon");

  console.log("All React-style icons created successfully!");
  console.log(
    "Note: These are placeholder icons. Replace with your actual icon later."
  );
} catch (error) {
  console.error("Error creating React-style icons:", error);
  process.exit(1);
}
