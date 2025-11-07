/**
 * Streaming Service
 *
 * Manages real-time data streaming sessions, handles Tauri events,
 * and coordinates with the Zustand store for state management.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "@/store/appStore";
import {
  StreamEvent,
  DataChunk,
  StreamingDDAResult,
  StreamStats,
  StreamState,
} from "@/types/streaming";

class StreamingService {
  private eventUnlistener: UnlistenFn | null = null;
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private isInitialized = false;

  /**
   * Initialize the streaming service
   * Sets up Tauri event listener for stream events
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn("[STREAMING SERVICE] Already initialized");
      return;
    }

    try {
      // Listen for stream events from Tauri backend
      this.eventUnlistener = await listen<StreamEvent>(
        "stream-event",
        (event) => {
          this.handleStreamEvent(event.payload);
        }
      );

      this.isInitialized = true;
      console.log("[STREAMING SERVICE] Initialized successfully");
    } catch (error) {
      console.error("[STREAMING SERVICE] Failed to initialize:", error);
      throw error;
    }
  }

  /**
   * Shutdown the streaming service
   * Stops all polling and removes event listener
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    // Stop all polling intervals
    for (const [streamId, interval] of this.pollingIntervals.entries()) {
      clearInterval(interval);
      console.log(`[STREAMING SERVICE] Stopped polling for stream: ${streamId}`);
    }
    this.pollingIntervals.clear();

    // Unlisten from Tauri events
    if (this.eventUnlistener) {
      this.eventUnlistener();
      this.eventUnlistener = null;
    }

    this.isInitialized = false;
    console.log("[STREAMING SERVICE] Shutdown complete");
  }

  /**
   * Handle stream events from Tauri backend
   */
  private handleStreamEvent(event: StreamEvent): void {
    const store = useAppStore.getState();

    // Update store with event
    store.handleStreamEvent(event);

    // Handle specific event types
    switch (event.type) {
      case "state_changed":
        console.log(`[STREAMING SERVICE] State changed for ${event.stream_id}:`, event.state);

        // Start/stop polling based on state (note: backend uses capital letters)
        if (event.state.type === "Running") {
          console.log(`[STREAMING SERVICE] Starting polling for ${event.stream_id}`);
          this.startPolling(event.stream_id);
        } else if (event.state.type === "Stopped" || event.state.type === "Error") {
          console.log(`[STREAMING SERVICE] Stopping polling for ${event.stream_id}`);
          this.stopPolling(event.stream_id);
        }
        break;

      case "data_received":
        console.log(`[STREAMING SERVICE] Data received for ${event.stream_id}: ${event.chunks_count} chunks`);
        // Fetch new data chunks
        this.fetchStreamData(event.stream_id);
        break;

      case "results_ready":
        console.log(`[STREAMING SERVICE] Results ready for ${event.stream_id}: ${event.results_count} results`);
        // Fetch new DDA results
        this.fetchStreamResults(event.stream_id);
        break;

      case "error":
        console.error(`[STREAMING SERVICE] Stream error for ${event.stream_id}:`, event.error);
        break;

      case "stats_update":
        // Stats are already updated by handleStreamEvent in store
        break;
    }
  }

  /**
   * Start polling for stream data and results
   */
  private startPolling(streamId: string): void {
    if (this.pollingIntervals.has(streamId)) {
      console.warn(`[STREAMING SERVICE] Already polling for stream: ${streamId}`);
      return;
    }

    // Poll every 500ms for new data and results
    const interval = setInterval(async () => {
      try {
        await Promise.all([
          this.fetchStreamData(streamId),
          this.fetchStreamResults(streamId),
          this.fetchStreamStats(streamId),
        ]);
      } catch (error) {
        console.error(`[STREAMING SERVICE] Polling error for ${streamId}:`, error);
      }
    }, 500);

    this.pollingIntervals.set(streamId, interval);
    console.log(`[STREAMING SERVICE] Started polling for stream: ${streamId}`);
  }

  /**
   * Stop polling for a stream
   */
  private stopPolling(streamId: string): void {
    const interval = this.pollingIntervals.get(streamId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(streamId);
      console.log(`[STREAMING SERVICE] Stopped polling for stream: ${streamId}`);
    }
  }

  /**
   * Fetch latest data chunks from a stream
   */
  private async fetchStreamData(streamId: string, count: number = 10): Promise<void> {
    try {
      const chunks = await invoke<DataChunk[]>("get_stream_data", {
        streamId,
        count,
      });

      if (chunks.length > 0) {
        const store = useAppStore.getState();
        chunks.forEach((chunk) => {
          store.addStreamData(streamId, chunk);
        });
      }
    } catch (error) {
      console.error(`[STREAMING SERVICE] Failed to fetch data for ${streamId}:`, error);
    }
  }

  /**
   * Fetch latest DDA results from a stream
   */
  private async fetchStreamResults(streamId: string, count: number = 10): Promise<void> {
    try {
      const results = await invoke<StreamingDDAResult[]>("get_stream_results", {
        streamId,
        count,
      });

      if (results.length > 0) {
        const store = useAppStore.getState();
        results.forEach((result) => {
          store.addStreamResult(streamId, result);
        });
      }
    } catch (error) {
      console.error(`[STREAMING SERVICE] Failed to fetch results for ${streamId}:`, error);
    }
  }

  /**
   * Fetch current statistics for a stream
   */
  private async fetchStreamStats(streamId: string): Promise<void> {
    try {
      console.log(`[STREAMING SERVICE] Fetching stats for ${streamId}...`);
      const stats = await invoke<StreamStats>("get_stream_stats", {
        streamId,
      });

      console.log(`[STREAMING SERVICE] Got stats for ${streamId}:`, stats);

      // Only update if stats are valid
      if (stats && typeof stats === 'object') {
        const store = useAppStore.getState();
        store.updateStreamSession(streamId, { stats });
        console.log(`[STREAMING SERVICE] Updated session with stats for ${streamId}`);
      } else {
        console.warn(`[STREAMING SERVICE] Invalid stats received for ${streamId}:`, stats);
      }
    } catch (error) {
      console.error(`[STREAMING SERVICE] Failed to fetch stats for ${streamId}:`, error);
    }
  }

  /**
   * Manually fetch stream state (useful for reconnection scenarios)
   */
  async fetchStreamState(streamId: string): Promise<StreamState | null> {
    try {
      const state = await invoke<StreamState>("get_stream_state", {
        streamId,
      });
      return state;
    } catch (error) {
      console.error(`[STREAMING SERVICE] Failed to fetch state for ${streamId}:`, error);
      return null;
    }
  }

  /**
   * Clear all buffers for a stream
   */
  async clearStreamBuffers(streamId: string): Promise<void> {
    try {
      await invoke("clear_stream_buffers", { streamId });

      const store = useAppStore.getState();
      store.clearStreamPlotData(streamId);

      console.log(`[STREAMING SERVICE] Cleared buffers for stream: ${streamId}`);
    } catch (error) {
      console.error(`[STREAMING SERVICE] Failed to clear buffers for ${streamId}:`, error);
      throw error;
    }
  }

  /**
   * List all active streams
   */
  async listStreams(): Promise<string[]> {
    try {
      const streamIds = await invoke<string[]>("list_streams");
      return streamIds;
    } catch (error) {
      console.error("[STREAMING SERVICE] Failed to list streams:", error);
      return [];
    }
  }
}

// Export singleton instance
export const streamingService = new StreamingService();

// Export convenience hooks
export function useStreamingService() {
  return streamingService;
}

/**
 * Hook to initialize streaming service on app startup
 * Call this from a top-level component or app initializer
 */
export function useInitializeStreaming() {
  const [isInitialized, setIsInitialized] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        await streamingService.initialize();
        if (mounted) {
          setIsInitialized(true);
        }
      } catch (err) {
        if (mounted) {
          setError(err as Error);
        }
      }
    };

    init();

    return () => {
      mounted = false;
      // Shutdown on unmount
      streamingService.shutdown();
    };
  }, []);

  return { isInitialized, error };
}

// Add React import if not already present
import React from "react";
