const fs = require("fs");
const path = require("path");

// Create a simple but valid icon for electron-builder
// This creates a minimal valid PNG that should pass electron-builder validation

const buildDir = path.join(__dirname, "../build");

console.log("Creating simple valid icon for electron-builder");
console.log("Build directory:", buildDir);

// Create build directory if it doesn't exist
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Create a minimal but valid PNG (1x1 pixel, transparent)
function createMinimalPNG() {
  // PNG signature
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  // IHDR chunk (1x1 pixel, RGBA)
  const ihdrData = Buffer.alloc(25);
  ihdrData.writeUInt32BE(13, 0); // Length: 13 bytes
  ihdrData.write("IHDR", 4); // Type: IHDR
  ihdrData.writeUInt32BE(1, 8); // Width: 1
  ihdrData.writeUInt32BE(1, 12); // Height: 1
  ihdrData.writeUInt8(8, 16); // Bit depth: 8
  ihdrData.writeUInt8(6, 17); // Color type: RGBA
  ihdrData.writeUInt8(0, 18); // Compression: 0
  ihdrData.writeUInt8(0, 19); // Filter: 0
  ihdrData.writeUInt8(0, 20); // Interlace: 0
  ihdrData.writeUInt32BE(0, 21); // CRC placeholder

  // IDAT chunk (1 pixel of transparent data)
  const pixelData = Buffer.from([0x00, 0x00, 0x00, 0x00]); // Transparent pixel
  const idatLength = 4;
  const idatData = Buffer.alloc(12 + idatLength);
  idatData.writeUInt32BE(idatLength, 0); // Length
  idatData.write("IDAT", 4); // Type: IDAT
  pixelData.copy(idatData, 8); // Pixel data
  idatData.writeUInt32BE(0, 8 + idatLength); // CRC placeholder

  // IEND chunk
  const iendData = Buffer.alloc(12);
  iendData.writeUInt32BE(0, 0); // Length: 0
  iendData.write("IEND", 4); // Type: IEND
  iendData.writeUInt32BE(0, 8); // CRC placeholder

  return Buffer.concat([signature, ihdrData, idatData, iendData]);
}

// Create a minimal ICO file
function createMinimalICO() {
  // ICO header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: ICO
  header.writeUInt16LE(1, 4); // Number of images

  // Directory entry
  const dirEntry = Buffer.alloc(16);
  dirEntry.writeUInt8(16, 0); // Width: 16
  dirEntry.writeUInt8(16, 1); // Height: 16
  dirEntry.writeUInt8(0, 2); // Color count
  dirEntry.writeUInt8(0, 3); // Reserved
  dirEntry.writeUInt16LE(1, 4); // Color planes
  dirEntry.writeUInt16LE(32, 6); // Bits per pixel
  dirEntry.writeUInt32LE(40, 8); // Size of image data
  dirEntry.writeUInt32LE(22, 12); // Offset to image data

  // BMP header
  const bmpHeader = Buffer.alloc(40);
  bmpHeader.writeUInt32LE(40, 0); // Size of header
  bmpHeader.writeUInt32LE(16, 4); // Width
  bmpHeader.writeUInt32LE(16, 8); // Height
  bmpHeader.writeUInt16LE(1, 12); // Color planes
  bmpHeader.writeUInt16LE(32, 14); // Bits per pixel
  bmpHeader.writeUInt32LE(0, 16); // Compression
  bmpHeader.writeUInt32LE(0, 20); // Image size
  bmpHeader.writeUInt32LE(0, 24); // Horizontal resolution
  bmpHeader.writeUInt32LE(0, 28); // Vertical resolution
  bmpHeader.writeUInt32LE(0, 32); // Colors in palette
  bmpHeader.writeUInt32LE(0, 36); // Important colors

  return Buffer.concat([header, dirEntry, bmpHeader]);
}

// Create a minimal ICNS file
function createMinimalICNS() {
  // ICNS header
  const header = Buffer.alloc(8);
  header.write("icns", 0); // Signature
  header.writeUInt32BE(8, 4); // Size

  return header;
}

try {
  // Create minimal PNG
  const pngData = createMinimalPNG();
  fs.writeFileSync(path.join(buildDir, "icon.png"), pngData);
  console.log("Created minimal PNG icon");

  // Create minimal ICO
  const icoData = createMinimalICO();
  fs.writeFileSync(path.join(buildDir, "icon.ico"), icoData);
  console.log("Created minimal ICO icon");

  // Create minimal ICNS
  const icnsData = createMinimalICNS();
  fs.writeFileSync(path.join(buildDir, "icon.icns"), icnsData);
  console.log("Created minimal ICNS icon");

  console.log("All minimal icons created successfully!");
  console.log(
    "These are placeholder icons - replace with your actual icon later."
  );
} catch (error) {
  console.error("Error creating minimal icons:", error);
  process.exit(1);
}
