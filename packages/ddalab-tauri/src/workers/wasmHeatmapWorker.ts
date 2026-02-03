/**
 * Web Worker for Heatmap Computations
 *
 * This worker runs heavy computations off the main thread to prevent UI blocking.
 * Uses pure JavaScript implementations that are optimized for worker execution.
 * The main benefit is keeping the main thread responsive, not WASM speed.
 *
 * Handles:
 * - transform_heatmap_with_stats: Log10 transform + statistics in one pass
 * - normalize_and_colormap: Normalize values and apply colormap
 * - RGB to RGBA conversion for ImageData
 */

// Types for worker messages
// NOTE: We use Float64Array (Transferable) instead of number[][] to avoid
// blocking structured clone serialization on the main thread.
export interface HeatmapWorkerRequest {
  id: string;
  type: "compute";
  payload: {
    // Flat Float64Array containing all channel data (transferred, zero-copy)
    flatData: Float64Array;
    numChannels: number;
    numTimePoints: number;
    floorValue: number;
    autoScale: boolean;
    colorRange: [number, number];
    colorScheme: number; // Colormap index
  };
}

export interface HeatmapWorkerResponse {
  id: string;
  type: "result" | "error";
  payload?: {
    // NOTE: heatmapData is intentionally NOT sent back to avoid blocking structured clone
    // The main thread only needs numChannels for length checks, and ImageBitmap for rendering
    computedColorRange: [number, number];
    imageBitmap: ImageBitmap | null; // Pre-rendered bitmap, ready for drawImage
    numChannels: number;
    numTimePoints: number;
  };
  error?: string;
}

/**
 * Pure JS implementation of heatmap transform with statistics.
 * Uses Welford's algorithm for numerically stable variance calculation.
 * Accepts flat Float64Array with dimensions for zero-copy transfer.
 */
function transformHeatmapWithStats(
  flatData: Float64Array,
  numChannels: number,
  numTimePoints: number,
  floorValue: number,
): {
  transformedData: Float64Array; // Flat transformed data
  stats: {
    min: number;
    max: number;
    mean: number;
    std: number;
    scaleMin: number;
    scaleMax: number;
    count: number;
  };
} {
  const totalPixels = numChannels * numTimePoints;
  const transformedData = new Float64Array(totalPixels);
  let min = Infinity;
  let max = -Infinity;
  let mean = 0;
  let m2 = 0;
  let count = 0;

  const log10 = Math.log10;
  const floor = floorValue > 0 ? floorValue : 0.001;

  for (let i = 0; i < totalPixels; i++) {
    const raw = flatData[i];
    const logVal = Number.isFinite(raw) ? log10(Math.max(raw, floor)) : 0;

    transformedData[i] = logVal;

    if (Number.isFinite(raw)) {
      count++;
      min = Math.min(min, logVal);
      max = Math.max(max, logVal);

      // Welford's online algorithm for stable variance
      const delta = logVal - mean;
      mean += delta / count;
      const delta2 = logVal - mean;
      m2 += delta * delta2;
    }
  }

  const variance = count > 1 ? m2 / (count - 1) : 0;
  const std = Math.sqrt(variance);
  const scaleMin = mean - 3 * std;
  const scaleMax = mean + 3 * std;

  return {
    transformedData,
    stats: { min, max, mean, std, count, scaleMin, scaleMax },
  };
}

/**
 * Pure JS implementation of normalize and colormap.
 * Returns RGBA data directly (avoiding extra conversion step).
 * Accepts Float64Array for efficiency.
 */
function normalizeAndColormapRGBA(
  data: Float64Array,
  colorMin: number,
  colorMax: number,
  colormapIndex: number,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length * 4);
  const range = colorMax - colorMin;
  const normFactor = Math.abs(range) > 1e-10 ? 1 / range : 0;

  for (let i = 0; i < data.length; i++) {
    const normalized = (data[i] - colorMin) * normFactor;
    const clamped = Math.max(0, Math.min(1, normalized));

    let r: number, g: number, b: number;

    // Apply colormap based on index
    // 0=viridis, 1=plasma, 2=inferno, 3=magma, 4=coolwarm, 5=jet, 6=cool, 7=hot
    switch (colormapIndex) {
      case 0: // viridis
        r = 0.267 + clamped * (0.329 + clamped * (1.452 - clamped * 1.046));
        g = Math.pow(clamped, 0.5);
        b = 0.329 + clamped * (1.452 - clamped * 1.781);
        break;
      case 1: // plasma
        r = Math.min(0.05 + clamped * 2.5, 1);
        g = Math.min(clamped * clamped * 0.8, 1);
        b = Math.max(
          0,
          Math.min(0.533 - clamped * 0.533 + clamped * clamped * 0.5, 1),
        );
        break;
      case 2: // inferno
        r = Math.min(clamped * 2, 1);
        g = Math.min(clamped * clamped * 1.5, 1);
        b = Math.max(
          0,
          Math.min(0.2 + clamped * 0.6 - clamped * clamped * 0.8, 1),
        );
        break;
      case 3: // magma
        r = Math.min(clamped * 1.8, 1);
        g = Math.min(clamped * clamped * 1.2, 1);
        b = Math.min(0.4 + clamped * 0.6, 1);
        break;
      case 4: // coolwarm
        r = clamped < 0.5 ? clamped * 2 : 1;
        g = clamped < 0.5 ? clamped * 2 : 2 - clamped * 2;
        b = clamped < 0.5 ? 1 : 2 - clamped * 2;
        break;
      case 5: // jet
        if (clamped < 0.25) {
          r = 0;
          g = clamped * 4;
          b = 1;
        } else if (clamped < 0.5) {
          r = 0;
          g = 1;
          b = 1 - (clamped - 0.25) * 4;
        } else if (clamped < 0.75) {
          r = (clamped - 0.5) * 4;
          g = 1;
          b = 0;
        } else {
          r = 1;
          g = 1 - (clamped - 0.75) * 4;
          b = 0;
        }
        break;
      case 6: // cool
        r = clamped;
        g = 1 - clamped;
        b = 1;
        break;
      case 7: // hot
        if (clamped < 0.33) {
          r = clamped * 3;
          g = 0;
          b = 0;
        } else if (clamped < 0.67) {
          r = 1;
          g = (clamped - 0.33) * 3;
          b = 0;
        } else {
          r = 1;
          g = 1;
          b = (clamped - 0.67) * 3;
        }
        break;
      default: // grayscale fallback
        r = g = b = clamped;
    }

    const idx = i * 4;
    result[idx] = Math.round(Math.max(0, Math.min(1, r)) * 255);
    result[idx + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
    result[idx + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
    result[idx + 3] = 255; // Alpha
  }

  return result;
}

async function handleComputeRequest(
  request: HeatmapWorkerRequest,
): Promise<HeatmapWorkerResponse> {
  const { id, payload } = request;
  const {
    flatData,
    numChannels,
    numTimePoints,
    floorValue,
    autoScale,
    colorRange,
    colorScheme,
  } = payload;

  try {
    const startTime = performance.now();
    const totalPixels = numChannels * numTimePoints;

    // Empty data check
    if (!flatData || flatData.length === 0 || totalPixels === 0) {
      return {
        id,
        type: "result",
        payload: {
          computedColorRange: [0, 1] as [number, number],
          imageBitmap: null,
          numChannels: 0,
          numTimePoints: 0,
        },
      };
    }

    // Step 1: Transform with stats (pure JS, optimized) - data already flat
    const transformStart = performance.now();
    const { transformedData, stats } = transformHeatmapWithStats(
      flatData,
      numChannels,
      numTimePoints,
      floorValue,
    );
    console.log(
      `[HeatmapWorker] Transform: ${(performance.now() - transformStart).toFixed(2)}ms`,
    );

    const computedRange: [number, number] = autoScale
      ? [stats.scaleMin, stats.scaleMax]
      : [stats.min, stats.max];

    // Use the provided colorRange for colormap, or computed range if autoScale
    const effectiveRange = autoScale ? computedRange : colorRange;

    // Step 2: Apply colormap and convert to RGBA in one pass (data already flat)
    const colormapStart = performance.now();
    const rgbaData = normalizeAndColormapRGBA(
      transformedData,
      effectiveRange[0],
      effectiveRange[1],
      colorScheme,
    );
    console.log(
      `[HeatmapWorker] Colormap+RGBA: ${(performance.now() - colormapStart).toFixed(2)}ms`,
    );

    // Step 5: Create ImageBitmap in worker (this is the expensive operation moved off main thread)
    const bitmapStart = performance.now();
    // Create ImageData - rgbaData is already a Uint8ClampedArray from normalizeAndColormapRGBA
    const imageData = new ImageData(
      rgbaData as unknown as Uint8ClampedArray<ArrayBuffer>,
      numTimePoints,
      numChannels,
    );
    const imageBitmap = await createImageBitmap(imageData);
    console.log(
      `[HeatmapWorker] ImageBitmap: ${(performance.now() - bitmapStart).toFixed(2)}ms`,
    );

    console.log(
      `[HeatmapWorker] Total: ${(performance.now() - startTime).toFixed(2)}ms, pixels: ${totalPixels}`,
    );

    return {
      id,
      type: "result",
      payload: {
        // NOTE: heatmapData intentionally not sent - structured clone of 2D array blocks main thread
        computedColorRange: computedRange,
        imageBitmap,
        numChannels,
        numTimePoints,
      },
    };
  } catch (error) {
    console.error("[HeatmapWorker] Error:", error);
    return {
      id,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Message handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).onmessage = async (event: MessageEvent<HeatmapWorkerRequest>) => {
  const request = event.data;

  if (request.type === "compute") {
    const response = await handleComputeRequest(request);

    // Transfer the ImageBitmap for zero-copy transfer to main thread
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerSelf = self as any;
    if (response.payload?.imageBitmap) {
      workerSelf.postMessage(response, [response.payload.imageBitmap]);
    } else {
      workerSelf.postMessage(response);
    }
  }
};

console.log("[HeatmapWorker] Worker initialized");
