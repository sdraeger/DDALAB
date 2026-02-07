/**
 * Hook for using the decimation Web Worker
 * Offloads WASM decimation to a background thread
 */

import { useEffect, useRef, useCallback, useState } from "react";
import type {
  WorkerRequest,
  WorkerResponse,
  DecimationMethod,
} from "@/workers/decimation.worker";

interface PendingRequest {
  resolve: (data: number[] | number[][]) => void;
  reject: (error: Error) => void;
}

interface UseDecimationWorkerResult {
  isReady: boolean;
  decimate: (
    data: number[],
    targetPoints: number,
    method?: DecimationMethod,
  ) => Promise<number[]>;
  decimateChannels: (
    data: number[][],
    targetPoints: number,
    method?: DecimationMethod,
  ) => Promise<number[][]>;
}

let sharedWorker: Worker | null = null;
let sharedWorkerReady = false;
let sharedPendingRequests = new Map<string, PendingRequest>();
let sharedReadyPromise: Promise<void> | null = null;
let sharedReadyResolve: (() => void) | null = null;

function getOrCreateWorker(): Worker {
  if (sharedWorker) return sharedWorker;

  // Create the worker
  sharedWorker = new Worker(
    new URL("../workers/decimation.worker.ts", import.meta.url),
    { type: "module" },
  );

  // Create ready promise
  sharedReadyPromise = new Promise((resolve) => {
    sharedReadyResolve = resolve;
  });

  // Handle worker messages
  sharedWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;

    if (response.type === "ready") {
      sharedWorkerReady = true;
      sharedReadyResolve?.();
      return;
    }

    if (response.id) {
      const pending = sharedPendingRequests.get(response.id);
      if (pending) {
        sharedPendingRequests.delete(response.id);

        if (response.type === "error") {
          pending.reject(new Error(response.error || "Worker error"));
        } else if (response.type === "result" && response.data) {
          pending.resolve(response.data);
        }
      }
    }
  };

  sharedWorker.onerror = (error) => {
    console.error("[DecimationWorker] Error:", error);
    // Reset worker state so it can be recreated on next use
    sharedWorker = null;
    sharedWorkerReady = false;
    sharedReadyPromise = null;
    sharedReadyResolve = null;
    // Reject all pending requests
    for (const [id, pending] of sharedPendingRequests.entries()) {
      sharedPendingRequests.delete(id);
      pending.reject(
        new Error(
          `Decimation worker failed: ${error.message || "Unknown error"}`,
        ),
      );
    }
  };

  // Initialize the worker
  sharedWorker.postMessage({ type: "init" } as WorkerRequest);

  return sharedWorker;
}

async function waitForReady(): Promise<void> {
  if (sharedWorkerReady) return;
  if (sharedReadyPromise) {
    await sharedReadyPromise;
  }
}

let requestCounter = 0;

const WORKER_TIMEOUT_MS = 30000; // 30 second timeout

function generateRequestId(): string {
  return `req_${++requestCounter}_${Date.now()}`;
}

export function useDecimationWorker(): UseDecimationWorkerResult {
  const [isReady, setIsReady] = useState(sharedWorkerReady);

  useEffect(() => {
    // Ensure worker is created
    getOrCreateWorker();

    // Wait for ready state
    if (!sharedWorkerReady) {
      waitForReady().then(() => {
        setIsReady(true);
      });
    }

    // No cleanup - we keep the worker alive for reuse
  }, []);

  const decimate = useCallback(
    async (
      data: number[],
      targetPoints: number,
      method: DecimationMethod = "lttb",
    ): Promise<number[]> => {
      const worker = getOrCreateWorker();
      await waitForReady();

      // Short-circuit if no decimation needed
      if (data.length <= targetPoints) {
        return data;
      }

      const id = generateRequestId();

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          sharedPendingRequests.delete(id);
          reject(new Error(`Worker timeout for request ${id}`));
        }, WORKER_TIMEOUT_MS);

        sharedPendingRequests.set(id, {
          resolve: (result) => {
            clearTimeout(timeoutId);
            resolve(result as number[]);
          },
          reject: (error) => {
            clearTimeout(timeoutId);
            reject(error);
          },
        });

        worker.postMessage({
          type: "decimate",
          id,
          data,
          targetPoints,
          method,
        } as WorkerRequest);
      });
    },
    [],
  );

  const decimateChannels = useCallback(
    async (
      data: number[][],
      targetPoints: number,
      method: DecimationMethod = "lttb",
    ): Promise<number[][]> => {
      const worker = getOrCreateWorker();
      await waitForReady();

      // Short-circuit if no decimation needed
      if (data.length === 0 || data[0].length <= targetPoints) {
        return data;
      }

      const id = generateRequestId();

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          sharedPendingRequests.delete(id);
          reject(new Error(`Worker timeout for request ${id}`));
        }, WORKER_TIMEOUT_MS);

        sharedPendingRequests.set(id, {
          resolve: (result) => {
            clearTimeout(timeoutId);
            resolve(result as number[][]);
          },
          reject: (error) => {
            clearTimeout(timeoutId);
            reject(error);
          },
        });

        worker.postMessage({
          type: "decimateChannels",
          id,
          data,
          targetPoints,
          method,
        } as WorkerRequest);
      });
    },
    [],
  );

  return { isReady, decimate, decimateChannels };
}

/**
 * Synchronous fallback for when worker is not available
 * Uses the main thread WASM service
 */
export async function decimateSync(
  data: number[],
  targetPoints: number,
  method: DecimationMethod = "lttb",
): Promise<number[]> {
  const { decimateData } = await import("@/services/wasmService");
  return decimateData(data, targetPoints, method);
}
