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

export function getDefaultPlotFilename(
  resultName: string,
  variantId: string,
  plotType: "heatmap" | "lineplot",
  format: "png" | "svg",
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `dda_${resultName}_${variantId}_${plotType}_${timestamp}.${format}`;
}
