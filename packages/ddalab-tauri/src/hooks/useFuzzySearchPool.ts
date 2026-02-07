/**
 * Worker pool for parallelized fuzzy search
 * Distributes work across multiple workers when WASM is unavailable
 */

import type {
  FuzzySearchRequest,
  FuzzySearchResponse,
} from "@/workers/fuzzySearch.worker";

interface PendingRequest {
  resolve: (results: number[]) => void;
  reject: (error: Error) => void;
  partialResults?: number[][];
  completedChunks?: number;
  totalChunks?: number;
}

const POOL_SIZE = Math.min(4, navigator.hardwareConcurrency || 2);
const CHUNK_SIZE = 500; // Process 500 targets per worker chunk

let workers: Worker[] = [];
let workerReady: boolean[] = [];
let pendingRequests = new Map<string, PendingRequest>();
let requestWorkerMap = new Map<string, number>();
let requestCounter = 0;
let poolInitialized = false;
let initPromise: Promise<void> | null = null;
let poolTerminating = false;

function getOrCreatePool(): Promise<void> {
  // If pool is being terminated, wait for termination to complete
  if (poolTerminating) {
    return Promise.reject(new Error("Worker pool is being terminated"));
  }

  if (poolInitialized) return Promise.resolve();

  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    let readyCount = 0;

    for (let i = 0; i < POOL_SIZE; i++) {
      const worker = new Worker(
        new URL("../workers/fuzzySearch.worker.ts", import.meta.url),
        { type: "module" },
      );

      workerReady.push(false);

      worker.onmessage = (event: MessageEvent<FuzzySearchResponse>) => {
        // Ignore messages if pool was terminated during init
        if (poolTerminating) return;

        const response = event.data;

        if (response.type === "ready") {
          workerReady[i] = true;
          readyCount++;
          if (readyCount === POOL_SIZE) {
            poolInitialized = true;
            resolve();
          }
          return;
        }

        if (response.id) {
          const pending = pendingRequests.get(response.id);
          if (pending) {
            if (response.type === "error") {
              pendingRequests.delete(response.id);
              requestWorkerMap.delete(response.id);
              pending.reject(new Error(response.error || "Worker error"));
            } else if (response.type === "result" && response.results) {
              // Check if this is a chunked request
              if (
                pending.partialResults &&
                pending.completedChunks !== undefined &&
                pending.totalChunks !== undefined
              ) {
                // Extract chunk index from ID (format: req_N_timestamp_chunkX)
                const chunkMatch = response.id.match(/_chunk(\d+)$/);
                const chunkIdx = chunkMatch ? parseInt(chunkMatch[1], 10) : 0;
                pending.partialResults[chunkIdx] = response.results;
                pending.completedChunks++;

                if (pending.completedChunks === pending.totalChunks) {
                  // All chunks complete, merge results
                  const merged = pending.partialResults.flat();
                  const baseId = response.id.replace(/_chunk\d+$/, "");
                  pendingRequests.delete(baseId);
                  requestWorkerMap.delete(baseId);
                  pending.resolve(merged);
                }
              } else {
                pendingRequests.delete(response.id);
                requestWorkerMap.delete(response.id);
                pending.resolve(response.results);
              }
            }
          }
        }
      };

      worker.onerror = (error) => {
        console.error(`[FuzzySearchPool] Worker ${i} error:`, error);
        workerReady[i] = false;
        // Only reject requests assigned to this specific worker
        const rejectedPendings = new Set<PendingRequest>();
        for (const [id, workerIdx] of requestWorkerMap.entries()) {
          if (workerIdx === i) {
            const pending = pendingRequests.get(id);
            if (pending && !rejectedPendings.has(pending)) {
              rejectedPendings.add(pending);
              pending.reject(
                new Error(
                  `Worker ${i} failed: ${error.message || "Unknown error"}`,
                ),
              );
            }
            pendingRequests.delete(id);
            requestWorkerMap.delete(id);
          }
        }
      };

      workers.push(worker);
    }
  });

  return initPromise;
}

function generateRequestId(): string {
  return `fuzzy_${++requestCounter}_${Date.now()}`;
}

function getNextAvailableWorker(): number {
  // Simple round-robin with fallback
  return requestCounter % POOL_SIZE;
}

/**
 * Perform batch Levenshtein distance calculation using worker pool
 */
export async function levenshteinBatchParallel(
  query: string,
  targets: string[],
): Promise<number[]> {
  await getOrCreatePool();

  // Small batches don't benefit from parallelization
  if (targets.length <= CHUNK_SIZE) {
    const id = generateRequestId();
    const workerIdx = getNextAvailableWorker();

    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      requestWorkerMap.set(id, workerIdx);
      workers[workerIdx].postMessage({
        type: "levenshteinBatch",
        id,
        query,
        targets,
      } as FuzzySearchRequest);
    });
  }

  // Split into chunks and distribute across workers
  const baseId = generateRequestId();
  const chunks: string[][] = [];
  for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
    chunks.push(targets.slice(i, i + CHUNK_SIZE));
  }

  return new Promise((resolve, reject) => {
    const pending: PendingRequest = {
      resolve,
      reject,
      partialResults: new Array(chunks.length),
      completedChunks: 0,
      totalChunks: chunks.length,
    };

    // Register the base request
    pendingRequests.set(baseId, pending);

    // Dispatch chunks to workers
    chunks.forEach((chunk, idx) => {
      const chunkId = `${baseId}_chunk${idx}`;
      const workerIdx = idx % POOL_SIZE;

      // Also register chunk ID pointing to same pending request
      pendingRequests.set(chunkId, pending);
      requestWorkerMap.set(chunkId, workerIdx);

      workers[workerIdx].postMessage({
        type: "levenshteinBatch",
        id: chunkId,
        query,
        targets: chunk,
      } as FuzzySearchRequest);
    });
  });
}

/**
 * Perform batch trigram similarity calculation using worker pool
 */
export async function trigramBatchParallel(
  query: string,
  targets: string[],
): Promise<number[]> {
  await getOrCreatePool();

  // Small batches don't benefit from parallelization
  if (targets.length <= CHUNK_SIZE) {
    const id = generateRequestId();
    const workerIdx = getNextAvailableWorker();

    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      requestWorkerMap.set(id, workerIdx);
      workers[workerIdx].postMessage({
        type: "trigramBatch",
        id,
        query,
        targets,
      } as FuzzySearchRequest);
    });
  }

  // Split into chunks and distribute across workers
  const baseId = generateRequestId();
  const chunks: string[][] = [];
  for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
    chunks.push(targets.slice(i, i + CHUNK_SIZE));
  }

  return new Promise((resolve, reject) => {
    const pending: PendingRequest = {
      resolve,
      reject,
      partialResults: new Array(chunks.length),
      completedChunks: 0,
      totalChunks: chunks.length,
    };

    pendingRequests.set(baseId, pending);

    chunks.forEach((chunk, idx) => {
      const chunkId = `${baseId}_chunk${idx}`;
      const workerIdx = idx % POOL_SIZE;

      pendingRequests.set(chunkId, pending);
      requestWorkerMap.set(chunkId, workerIdx);

      workers[workerIdx].postMessage({
        type: "trigramBatch",
        id: chunkId,
        query,
        targets: chunk,
      } as FuzzySearchRequest);
    });
  });
}

/**
 * Terminate all workers in the pool
 */
export function terminatePool(): void {
  // Set terminating flag to prevent new requests and ignore pending callbacks
  poolTerminating = true;

  // Reject all pending requests before termination
  for (const [id, pending] of pendingRequests.entries()) {
    pending.reject(new Error("Worker pool terminated"));
  }
  pendingRequests.clear();
  requestWorkerMap.clear();

  workers.forEach((worker) => worker.terminate());
  workers = [];
  workerReady = [];
  poolInitialized = false;
  initPromise = null;

  // Reset terminating flag so pool can be recreated if needed
  poolTerminating = false;
}
