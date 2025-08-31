const fs = require("fs");
const path = require("path");
const { createCanvas } = require("canvas");

// Create a proper icon for electron-builder (256x256)
const buildDir = path.join(__dirname, "../build");

console.log("Creating proper 256x256 icon for electron-builder");
console.log("Build directory:", buildDir);

// Create build directory if it doesn't exist
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Create a 256x256 canvas
const canvas = createCanvas(256, 256);
const ctx = canvas.getContext("2d");

// Draw a simple React-like logo
// Background
ctx.fillStyle = "#282c34";
ctx.fillRect(0, 0, 256, 256);

// React logo color
ctx.strokeStyle = "#61dafb";
ctx.lineWidth = 4;

// Draw three ellipses to create React-like logo
function drawEllipse(cx, cy, rx, ry, angle) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

// Center of the canvas
const centerX = 128;
const centerY = 128;

// Draw the ellipses
drawEllipse(centerX, centerY, 60, 20, 0);
drawEllipse(centerX, centerY, 60, 20, (2 * Math.PI) / 3);
drawEllipse(centerX, centerY, 60, 20, (4 * Math.PI) / 3);

// Draw center circle
ctx.beginPath();
ctx.arc(centerX, centerY, 12, 0, 2 * Math.PI);
ctx.fillStyle = "#61dafb";
ctx.fill();

// Save as PNG
const pngBuffer = canvas.toBuffer("image/png");
fs.writeFileSync(path.join(buildDir, "icon.png"), pngBuffer);
console.log("Created 256x256 PNG icon");

// For ICO and ICNS, we'll use the PNG we just created
// Note: For production, you should use proper conversion tools
console.log("Note: For ICO and ICNS conversion, install electron-icon-builder");
console.log("Run: npm install -g electron-icon-builder");
console.log("Then: electron-icon-builder --input=build/icon.png --output=build/");
