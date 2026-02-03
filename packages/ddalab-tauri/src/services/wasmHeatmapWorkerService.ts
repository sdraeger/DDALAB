/**
 * Service for managing the WASM Heatmap Web Worker
 *
 * This service provides a Promise-based API for offloading heavy WASM
 * computations to a Web Worker, keeping the main thread responsive.
 */

import type { ColorScheme } from "@/components/dda/ColorSchemePicker";
import type {
  HeatmapWorkerRequest,
  HeatmapWorkerResponse,
} from "@/workers/wasmHeatmapWorker";

export interface HeatmapComputeResult {
  // NOTE: heatmapData is intentionally NOT returned - structured clone of 2D array blocks main thread
  // Use numChannels for length checks instead
  computedColorRange: [number, number];
  imageBitmap: ImageBitmap | null; // Pre-rendered bitmap ready for canvas drawImage
  numChannels: number;
  numTimePoints: number;
}

type PendingRequest = {
  resolve: (result: HeatmapComputeResult) => void;
  reject: (error: Error) => void;
};

class WasmHeatmapWorkerService {
  private worker: Worker | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestCounter = 0;
  private initPromise: Promise<void> | null = null;

  private getColormapIndex(colorScheme: ColorScheme): number {
    // Map ColorScheme to WASM colormap indices
    // WASM supports: 0=viridis, 1=plasma, 2=inferno, 3=magma, 4=coolwarm, 5=jet, 6=cool, 7=hot
    const colormapIndices: Record<ColorScheme, number> = {
      viridis: 0,
      plasma: 1,
      inferno: 2,
      jet: 5,
      cool: 6,
      hot: 7,
    };
    return colormapIndices[colorScheme] ?? 0;
  }

  private async initWorker(): Promise<void> {
    if (this.worker) return;

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      try {
        // Create the worker using the module worker syntax
        this.worker = new Worker(
          new URL("../workers/wasmHeatmapWorker.ts", import.meta.url),
          { type: "module" },
        );

        this.worker.onmessage = (
          event: MessageEvent<HeatmapWorkerResponse>,
        ) => {
          const response = event.data;
          const pending = this.pendingRequests.get(response.id);

          if (!pending) {
            console.warn(
              "[WasmHeatmapWorkerService] Received response for unknown request:",
              response.id,
            );
            return;
          }

          this.pendingRequests.delete(response.id);

          if (response.type === "error") {
            pending.reject(new Error(response.error ?? "Unknown worker error"));
          } else if (response.payload) {
            pending.resolve(response.payload);
          } else {
            pending.reject(new Error("Invalid worker response: no payload"));
          }
        };

        this.worker.onerror = (error) => {
          console.error("[WasmHeatmapWorkerService] Worker error:", error);
          // Reject all pending requests
          for (const [id, pending] of this.pendingRequests) {
            pending.reject(new Error(`Worker error: ${error.message}`));
            this.pendingRequests.delete(id);
          }
        };

        // Give the worker a moment to initialize
        setTimeout(resolve, 50);
      } catch (error) {
        reject(error);
      }
    });

    return this.initPromise;
  }

  /**
   * Compute heatmap data using the Web Worker.
   * This runs the heavy WASM computations off the main thread.
   *
   * IMPORTANT: Data is flattened to Float64Array and transferred (zero-copy)
   * to avoid blocking the main thread during structured clone serialization.
   */
  async computeHeatmapData(
    rawChannelData: number[][],
    floorValue: number,
    autoScale: boolean,
    colorRange: [number, number],
    colorScheme: ColorScheme,
  ): Promise<HeatmapComputeResult> {
    await this.initWorker();

    if (!this.worker) {
      throw new Error("Worker not initialized");
    }

    const id = `heatmap-${++this.requestCounter}`;

    // Flatten 2D array to Float64Array for zero-copy transfer
    // This is much faster than structured clone of nested arrays
    const numChannels = rawChannelData.length;
    const numTimePoints = numChannels > 0 ? rawChannelData[0].length : 0;
    const totalPixels = numChannels * numTimePoints;

    if (totalPixels === 0) {
      return {
        computedColorRange: [0, 1],
        imageBitmap: null,
        numChannels: 0,
        numTimePoints: 0,
      };
    }

    // Flatten to typed array using TypedArray.set() - much faster than element-by-element
    const flatData = new Float64Array(totalPixels);

    // Use a non-blocking approach: schedule the flatten work to yield frequently
    // Target ~8ms chunks (half of 16ms frame budget) to keep UI responsive
    const TARGET_CHUNK_MS = 8;
    let currentChannel = 0;

    await new Promise<void>((resolve) => {
      const processChunk = () => {
        const startTime = performance.now();

        // Process channels until we hit the time budget
        while (currentChannel < numChannels) {
          flatData.set(
            rawChannelData[currentChannel],
            currentChannel * numTimePoints,
          );
          currentChannel++;

          // Check time budget every few channels
          if (
            currentChannel % 2 === 0 &&
            performance.now() - startTime > TARGET_CHUNK_MS
          ) {
            // Yield to event loop using requestAnimationFrame for smoother scheduling
            if (typeof requestAnimationFrame !== "undefined") {
              requestAnimationFrame(processChunk);
            } else {
              setTimeout(processChunk, 0);
            }
            return;
          }
        }

        // All done
        resolve();
      };

      // Start processing, but use RAF to let current frame finish first
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(processChunk);
      } else {
        setTimeout(processChunk, 0);
      }
    });

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const request: HeatmapWorkerRequest = {
        id,
        type: "compute",
        payload: {
          flatData,
          numChannels,
          numTimePoints,
          floorValue,
          autoScale,
          colorRange,
          colorScheme: this.getColormapIndex(colorScheme),
        },
      };

      // Transfer the Float64Array's underlying buffer - this is zero-copy!
      // The flatData becomes "detached" after this call (unusable on main thread)
      this.worker!.postMessage(request, [flatData.buffer]);
    });
  }

  /**
   * Terminate the worker and clean up resources.
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.initPromise = null;

      // Reject any pending requests
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(new Error("Worker terminated"));
        this.pendingRequests.delete(id);
      }
    }
  }

  /**
   * Check if the worker is available.
   */
  isAvailable(): boolean {
    return typeof Worker !== "undefined";
  }

  /**
   * Pre-initialize the worker without doing any computation.
   * Call this ahead of time (e.g., when user hovers over results tab) to reduce
   * perceived latency when the first heatmap is requested.
   */
  async warmup(): Promise<void> {
    if (this.isAvailable()) {
      await this.initWorker();
    }
  }
}

// Singleton instance
export const wasmHeatmapWorker = new WasmHeatmapWorkerService();

// Convenience function for direct use
export async function computeHeatmapDataOffThread(
  rawChannelData: number[][],
  floorValue: number,
  autoScale: boolean,
  colorRange: [number, number],
  colorScheme: ColorScheme,
): Promise<HeatmapComputeResult> {
  return wasmHeatmapWorker.computeHeatmapData(
    rawChannelData,
    floorValue,
    autoScale,
    colorRange,
    colorScheme,
  );
}
