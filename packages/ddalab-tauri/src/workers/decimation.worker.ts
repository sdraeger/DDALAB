/**
 * Web Worker for WASM-accelerated decimation
 * Offloads heavy signal processing from main thread
 */

// Worker message types
export type DecimationMethod = "lttb" | "minmax" | "average";

export interface DecimateRequest {
  type: "decimate";
  id: string;
  data: number[];
  targetPoints: number;
  method: DecimationMethod;
}

export interface DecimateChannelsRequest {
  type: "decimateChannels";
  id: string;
  data: number[][];
  targetPoints: number;
  method: DecimationMethod;
}

export interface InitRequest {
  type: "init";
}

export type WorkerRequest =
  | DecimateRequest
  | DecimateChannelsRequest
  | InitRequest;

export interface WorkerResponse {
  type: "result" | "error" | "ready";
  id?: string;
  data?: number[] | number[][];
  error?: string;
}

// WASM module state
let wasmFunctions: any = null;
let isInitialized = false;

// Initialize WASM in the worker
async function initWasm(): Promise<void> {
  if (isInitialized) return;

  try {
    const wasm = await import("../../../ddalab-wasm/pkg/ddalab_wasm");
    await wasm.default();
    wasmFunctions = wasm;
    isInitialized = true;
    self.postMessage({ type: "ready" } as WorkerResponse);
  } catch (error) {
    console.warn("[Worker] WASM init failed, using JS fallback:", error);
    isInitialized = true;
    self.postMessage({ type: "ready" } as WorkerResponse);
  }
}

// LTTB decimation - JS fallback
function decimateLttbJS(data: number[], targetPoints: number): number[] {
  const len = data.length;

  if (targetPoints >= len || len <= 2) {
    return [...data];
  }

  if (targetPoints < 2) {
    return len > 0 ? [data[0], data[len - 1]] : [];
  }

  const result: number[] = [data[0]];
  const bucketSize = (len - 2) / (targetPoints - 2);

  let aIndex = 0;

  for (let i = 0; i < targetPoints - 2; i++) {
    const bucketStart = Math.floor(i * bucketSize + 1);
    const bucketEnd = Math.min(Math.floor((i + 1) * bucketSize + 1), len - 1);

    const nextBucketStart = bucketEnd;
    const nextBucketEnd = Math.min(Math.floor((i + 2) * bucketSize + 1), len);

    let avgX = 0;
    let avgY = 0;
    if (nextBucketStart < nextBucketEnd) {
      for (let j = nextBucketStart; j < nextBucketEnd; j++) {
        avgX += j;
        avgY += data[j];
      }
      const count = nextBucketEnd - nextBucketStart;
      avgX /= count;
      avgY /= count;
    } else {
      avgX = len - 1;
      avgY = data[len - 1];
    }

    let maxArea = -1;
    let maxAreaIndex = bucketStart;

    const pointAX = aIndex;
    const pointAY = data[aIndex];

    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs(
        (pointAX - avgX) * (data[j] - pointAY) -
          (pointAX - j) * (avgY - pointAY),
      );

      if (area > maxArea) {
        maxArea = area;
        maxAreaIndex = j;
      }
    }

    result.push(data[maxAreaIndex]);
    aIndex = maxAreaIndex;
  }

  result.push(data[len - 1]);

  return result;
}

// Decimate single channel
function decimateData(
  data: number[],
  targetPoints: number,
  method: DecimationMethod = "lttb",
): number[] {
  if (data.length <= targetPoints) {
    return data;
  }

  if (!wasmFunctions) {
    return decimateLttbJS(data, targetPoints);
  }

  const float64Data = new Float64Array(data);
  let result: Float64Array;

  switch (method) {
    case "lttb":
      result = wasmFunctions.decimate_lttb(float64Data, targetPoints);
      break;
    case "minmax":
      result = wasmFunctions.decimate_minmax(float64Data, targetPoints / 2);
      break;
    case "average":
      result = wasmFunctions.decimate_average(float64Data, targetPoints);
      break;
    default:
      result = wasmFunctions.decimate_lttb(float64Data, targetPoints);
  }

  return Array.from(result);
}

// Decimate multiple channels
function decimateChannels(
  data: number[][],
  targetPoints: number,
  method: DecimationMethod = "lttb",
): number[][] {
  if (data.length === 0) return [];

  const pointsPerChannel = data[0].length;
  const numChannels = data.length;

  if (pointsPerChannel <= targetPoints) {
    return data;
  }

  if (!wasmFunctions || method !== "lttb") {
    return data.map((channelData) =>
      decimateData(channelData, targetPoints, method),
    );
  }

  // Use batch LTTB decimation
  const flatData = new Float64Array(numChannels * pointsPerChannel);
  for (let ch = 0; ch < numChannels; ch++) {
    flatData.set(data[ch], ch * pointsPerChannel);
  }

  const flatResult = wasmFunctions.decimate_channels_lttb(
    flatData,
    numChannels,
    pointsPerChannel,
    targetPoints,
  );

  // Split results back into channels
  const results: number[][] = [];
  const actualPointsPerChannel = flatResult.length / numChannels;

  for (let ch = 0; ch < numChannels; ch++) {
    const start = ch * actualPointsPerChannel;
    const end = start + actualPointsPerChannel;
    results.push(Array.from(flatResult.slice(start, end)));
  }

  return results;
}

// Handle incoming messages
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case "init":
        await initWasm();
        break;

      case "decimate": {
        const result = decimateData(
          request.data,
          request.targetPoints,
          request.method,
        );
        self.postMessage({
          type: "result",
          id: request.id,
          data: result,
        } as WorkerResponse);
        break;
      }

      case "decimateChannels": {
        const result = decimateChannels(
          request.data,
          request.targetPoints,
          request.method,
        );
        self.postMessage({
          type: "result",
          id: request.id,
          data: result,
        } as WorkerResponse);
        break;
      }
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      id: (request as any).id,
      error: error instanceof Error ? error.message : String(error),
    } as WorkerResponse);
  }
};

// Initialize immediately
initWasm();
