export async function canvasToPNG(
  canvas: HTMLCanvasElement,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to convert canvas to blob"));
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result));
        } else {
          reject(new Error("Failed to read blob as ArrayBuffer"));
        }
      };
      reader.onerror = () => reject(new Error("FileReader error"));
      reader.readAsArrayBuffer(blob);
    }, "image/png");
  });
}

export async function canvasToSVG(
  canvas: HTMLCanvasElement,
): Promise<Uint8Array> {
  const dataURL = canvas.toDataURL("image/png");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
  <image width="${canvas.width}" height="${canvas.height}" xlink:href="${dataURL}"/>
</svg>`;

  const encoder = new TextEncoder();
  return encoder.encode(svg);
}

export async function canvasToPDF(
  canvas: HTMLCanvasElement,
): Promise<Uint8Array> {
  // Get PNG data as base64
  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to convert canvas to blob"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });

  const pngArrayBuffer = await pngBlob.arrayBuffer();
  const pngBytes = new Uint8Array(pngArrayBuffer);

  // PDF dimensions (convert pixels to points, assuming 96 DPI)
  const width = (canvas.width * 72) / 96;
  const height = (canvas.height * 72) / 96;

  // Create a minimal PDF with embedded PNG image
  // This is a simplified PDF structure that should work with most readers
  const pdfParts: Uint8Array[] = [];
  const encoder = new TextEncoder();

  // Helper to add text
  const addText = (text: string) => {
    pdfParts.push(encoder.encode(text));
  };

  // PDF Header
  addText("%PDF-1.4\n");
  addText("%\xE2\xE3\xCF\xD3\n"); // Binary marker

  // Object 1: Catalog
  addText("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // Object 2: Pages
  addText("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  // Object 3: Page
  addText(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>\nendobj\n`,
  );

  // Object 4: Content Stream
  const contentStream = `q\n${width.toFixed(2)} 0 0 ${height.toFixed(2)} 0 0 cm\n/Im1 Do\nQ\n`;
  addText(
    `4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`,
  );

  // Object 5: Image
  const imageHeader = `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${pngBytes.length} >>\nstream\n`;
  addText(imageHeader);
  pdfParts.push(pngBytes);
  addText("\nendstream\nendobj\n");

  // Calculate xref offsets
  let offset = 0;
  const offsets: number[] = [0]; // Object 0
  for (let i = 0; i < pdfParts.length - 1; i++) {
    offset += pdfParts[i].length;
    if (i === 0) offsets.push(offset); // Object 1
    if (i === 1) offsets.push(offset); // Object 2
    if (i === 2) offsets.push(offset); // Object 3
    if (i === 3) offsets.push(offset); // Object 4
    if (i === 4) offsets.push(offset); // Object 5
  }

  // Recalculate offsets properly
  const xrefStart = offset + pdfParts[pdfParts.length - 1].length;

  // Cross-reference table
  addText("xref\n");
  addText("0 6\n");
  addText("0000000000 65535 f \n");
  for (let i = 1; i <= 5; i++) {
    const off = offsets[i] || 0;
    addText(`${off.toString().padStart(10, "0")} 00000 n \n`);
  }

  // Trailer
  addText("trailer\n<< /Size 6 /Root 1 0 R >>\n");
  addText(`startxref\n${xrefStart}\n%%EOF\n`);

  // Combine all parts
  const totalLength = pdfParts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let position = 0;
  for (const part of pdfParts) {
    result.set(part, position);
    position += part.length;
  }

  return result;
}

export function getDefaultPlotFilename(
  resultName: string,
  variantId: string,
  plotType: "heatmap" | "lineplot",
  format: "png" | "svg" | "pdf",
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `dda_${resultName}_${variantId}_${plotType}_${timestamp}.${format}`;
}
