/**
 * Streaming Service
 *
 * Manages real-time data streaming sessions, handles Tauri events,
 * and coordinates with the Zustand store for state management.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  getStateManager,
  isStateManagerRegistered,
  type IStreamingStateManager,
} from "@/services/stateManager";
import {
  StreamEvent,
  DataChunk,
  StreamingDDAResult,
  StreamStats,
  StreamState,
  BridgeState,
} from "@/types/streaming";

/**
 * Helper to safely get state manager for streaming operations.
 */
function getStreamingState(): IStreamingStateManager | null {
  if (!isStateManagerRegistered()) {
    return null;
  }
  return getStateManager();
}

class StreamingService {
  private eventUnlistener: UnlistenFn | null = null;
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private bridgeHealthInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private lastEventTime: Map<string, number> = new Map();
  private readonly EVENT_DEBOUNCE_MS = 50;

  /**
   * Initialize the streaming service
   * Sets up Tauri event listener for stream events
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Listen for stream events from Tauri backend
      this.eventUnlistener = await listen<StreamEvent>(
        "stream-event",
        (event) => {
          this.handleStreamEvent(event.payload);
        },
      );

      this.isInitialized = true;
    } catch (error) {
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
    }
    this.pollingIntervals.clear();
    this.lastEventTime.clear();
    this.stopBridgeHealthPolling();

    // Unlisten from Tauri events
    if (this.eventUnlistener) {
      this.eventUnlistener();
      this.eventUnlistener = null;
    }

    this.isInitialized = false;
  }

  /**
   * Handle stream events from Tauri backend
   */
  private handleStreamEvent(event: StreamEvent): void {
    const state = getStreamingState();
    if (!state) return;

    // Update store with event
    state.handleStreamEvent(event);

    // Debounce non-critical events only (stats, data_received, results_ready)
    // State changes and errors should always go through
    if (event.type !== "state_changed" && event.type !== "error") {
      const eventKey = `${event.stream_id}:${event.type}`;
      const now = Date.now();
      const lastTime = this.lastEventTime.get(eventKey) || 0;

      if (now - lastTime < this.EVENT_DEBOUNCE_MS) {
        return; // Skip duplicate events within debounce window
      }
      this.lastEventTime.set(eventKey, now);
    }

    // Handle specific event types
    switch (event.type) {
      case "state_changed":
        // Start/stop polling based on state
        if (event.state.type === "Running") {
          this.startPolling(event.stream_id);
        } else if (
          event.state.type === "Stopped" ||
          event.state.type === "Error"
        ) {
          this.stopPolling(event.stream_id);
        }
        break;

      case "data_received":
        // Fetch new data chunks
        this.fetchStreamData(event.stream_id, event.chunks_count);
        break;

      case "results_ready":
        // Fetch new DDA results
        this.fetchStreamResults(event.stream_id, event.results_count);
        break;

      case "error":
        break;

      case "stats_update":
        // Stats are already updated by handleStreamEvent in store
        break;
    }
  }

  /**
   * Start polling for stream data and results
   * Polling acts as a fallback if events are missed
   */
  private startPolling(streamId: string): void {
    if (this.pollingIntervals.has(streamId)) {
      return;
    }

    // Poll every 100ms for smooth, fluid updates
    const interval = setInterval(async () => {
      try {
        await Promise.all([
          this.fetchStreamData(streamId, 20),
          this.fetchStreamResults(streamId, 20),
        ]);
      } catch {
        // Polling errors are non-critical
      }
    }, 100);

    this.pollingIntervals.set(streamId, interval);
  }

  /**
   * Stop polling for a stream
   */
  private stopPolling(streamId: string): void {
    const interval = this.pollingIntervals.get(streamId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(streamId);
    }
  }

  /**
   * Fetch latest data chunks from a stream
   */
  private async fetchStreamData(
    streamId: string,
    count: number = 10,
  ): Promise<void> {
    try {
      const chunks = await invoke<DataChunk[]>("get_stream_data", {
        streamId,
        count,
      });

      if (chunks.length > 0) {
        const state = getStreamingState();
        if (state) {
          chunks.forEach((chunk) => {
            state.addStreamData(streamId, chunk);
          });
        }
      }
    } catch {
      // Fetch errors handled silently - will retry on next poll
    }
  }

  /**
   * Fetch latest DDA results from a stream
   */
  private async fetchStreamResults(
    streamId: string,
    count: number = 10,
  ): Promise<void> {
    try {
      const results = await invoke<StreamingDDAResult[]>("get_stream_results", {
        streamId,
        count,
      });

      if (results.length > 0) {
        const state = getStreamingState();
        if (state) {
          results.forEach((result) => {
            state.addStreamResult(streamId, result);
          });
        }
      }
    } catch {
      // Fetch errors handled silently - will retry on next poll
    }
  }

  /**
   * Fetch current statistics for a stream (rarely needed - stats come via events)
   */
  private async fetchStreamStats(streamId: string): Promise<void> {
    try {
      const stats = await invoke<StreamStats>("get_stream_stats", {
        streamId,
      });

      if (stats && typeof stats === "object") {
        const state = getStreamingState();
        if (state) {
          state.updateStreamSession(streamId, { stats });
        }
      }
    } catch {
      // Stats fetch errors handled silently
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
    } catch {
      return null;
    }
  }

  /**
   * Clear all buffers for a stream
   */
  async clearStreamBuffers(streamId: string): Promise<void> {
    try {
      await invoke("clear_stream_buffers", { streamId });

      const state = getStreamingState();
      if (state) {
        state.clearStreamPlotData(streamId);
      }
    } catch (error) {
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
    } catch {
      return [];
    }
  }

  /**
   * Start polling LSL bridge health when bridge is running.
   * Polls every 5 seconds and updates store if state changes.
   */
  startBridgeHealthPolling(): void {
    if (this.bridgeHealthInterval) return;

    this.bridgeHealthInterval = setInterval(async () => {
      const state = getStreamingState();
      if (!state) return;

      try {
        const bridgeState = await invoke<BridgeState>("get_lsl_bridge_state");
        state.updateBridgeState(bridgeState);

        // Stop polling if bridge is no longer running
        if (bridgeState.type !== "Running") {
          this.stopBridgeHealthPolling();
        }
      } catch {
        // Polling errors are non-critical
      }
    }, 5000);
  }

  stopBridgeHealthPolling(): void {
    if (this.bridgeHealthInterval) {
      clearInterval(this.bridgeHealthInterval);
      this.bridgeHealthInterval = null;
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
