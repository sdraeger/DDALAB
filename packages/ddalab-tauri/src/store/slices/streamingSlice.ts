/**
 * Streaming state slice
 */

import type {
  StreamingSlice,
  StreamingState,
  ImmerStateCreator,
} from "./types";

export const defaultStreamingState: StreamingState = {
  sessions: {},
  plotData: {},
  ui: {
    isConfigDialogOpen: false,
    selectedStreamId: null,
    autoScroll: true,
    showHeatmap: true,
    visibleChannels: null,
    displayWindowSeconds: 30,
    recentSources: [],
  },
};

let isCreatingSession = false;

export const createStreamingSlice: ImmerStateCreator<StreamingSlice> = (
  set,
  get,
) => ({
  streaming: defaultStreamingState,

  createStreamSession: async (sourceConfig, ddaConfig) => {
    if (isCreatingSession) {
      throw new Error("Session creation already in progress");
    }
    isCreatingSession = true;

    const { invoke } = await import("@tauri-apps/api/core");

    try {
      const now = Date.now() / 1000;
      let streamId: string | null = null;

      const response = await invoke<{ stream_id: string }>("start_stream", {
        request: {
          source_config: sourceConfig,
          dda_config: ddaConfig,
        },
      });

      streamId = response.stream_id;

      set((state) => {
        if (state.streaming.sessions[streamId]) {
          state.streaming.sessions[streamId].source_config = sourceConfig;
          state.streaming.sessions[streamId].dda_config = ddaConfig;
          state.streaming.sessions[streamId].updated_at = Date.now() / 1000;
        } else {
          state.streaming.sessions[streamId] = {
            id: streamId,
            source_config: sourceConfig,
            dda_config: ddaConfig,
            state: { type: "Connecting" },
            stats: {
              chunks_received: 0,
              chunks_processed: 0,
              results_generated: 0,
              data_buffer_size: 0,
              result_buffer_size: 0,
              total_samples_received: 0,
              avg_processing_time_ms: 0,
              uptime_seconds: 0,
            },
            created_at: now,
            updated_at: now,
          };
          state.streaming.plotData[streamId] = {
            dataChunks: [],
            ddaResults: [],
            maxBufferSize: 100,
          };
        }
      });

      get().addToStreamHistory(sourceConfig, ddaConfig);
      return streamId;
    } catch {
      throw new Error("Failed to create streaming session");
    } finally {
      isCreatingSession = false;
    }
  },

  stopStreamSession: async (streamId) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stop_stream", { streamId });

    set((state) => {
      const session = state.streaming.sessions[streamId];
      if (session) {
        session.state = { type: "Stopped" };
      }
    });
  },

  pauseStreamSession: async (streamId) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("pause_stream", { streamId });
  },

  resumeStreamSession: async (streamId) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("resume_stream", { streamId });
  },

  updateStreamSession: (streamId, updates) => {
    set((state) => {
      const session = state.streaming.sessions[streamId];
      if (session) {
        if (updates.state) session.state = updates.state;
        if (updates.stats) session.stats = updates.stats;
        if (updates.source_config)
          session.source_config = updates.source_config;
        if (updates.dda_config) session.dda_config = updates.dda_config;
        session.updated_at = Date.now() / 1000;
      }
    });
  },

  removeStreamSession: (streamId) => {
    set((state) => {
      delete state.streaming.sessions[streamId];
      delete state.streaming.plotData[streamId];
    });
  },

  addStreamData: (streamId, chunk) => {
    set((state) => {
      const plotData = state.streaming.plotData[streamId];
      if (plotData) {
        const { dataChunks, maxBufferSize } = plotData;

        if (dataChunks.length >= maxBufferSize) {
          const removeCount = Math.floor(maxBufferSize * 0.2);
          dataChunks.splice(0, removeCount);
        }

        dataChunks.push(Object.freeze(chunk));
      }
    });
  },

  addStreamResult: (streamId, result) => {
    set((state) => {
      const plotData = state.streaming.plotData[streamId];
      if (plotData) {
        const { ddaResults, maxBufferSize } = plotData;

        if (ddaResults.length >= maxBufferSize) {
          const removeCount = Math.floor(maxBufferSize * 0.2);
          ddaResults.splice(0, removeCount);
        }

        ddaResults.push(Object.freeze(result));
      }
    });
  },

  clearStreamPlotData: (streamId) => {
    set((state) => {
      const plotData = state.streaming.plotData[streamId];
      if (plotData) {
        plotData.dataChunks = [];
        plotData.ddaResults = [];
      }
    });
  },

  updateStreamUI: (updates) => {
    set((state) => {
      // Use spread for partial updates - more idiomatic with Immer
      state.streaming.ui = { ...state.streaming.ui, ...updates };
    });
  },

  handleStreamEvent: (event) => {
    switch (event.type) {
      case "state_changed":
        set((state) => {
          const session = state.streaming.sessions[event.stream_id];

          if (!session) {
            const now = Date.now() / 1000;
            state.streaming.sessions[event.stream_id] = {
              id: event.stream_id,
              source_config: {
                type: "file",
                path: "",
                chunk_size: 0,
                loop_playback: false,
              },
              dda_config: {
                window_size: 0,
                window_overlap: 0,
                window_parameters: { window_length: 0, window_step: 0 },
                scale_parameters: {
                  scale_min: 0,
                  scale_max: 0,
                  scale_num: 0,
                },
                algorithm_selection: { enabled_variants: [] },
                include_q_matrices: false,
              },
              state: event.state,
              stats: {
                chunks_received: 0,
                chunks_processed: 0,
                results_generated: 0,
                data_buffer_size: 0,
                result_buffer_size: 0,
                total_samples_received: 0,
                avg_processing_time_ms: 0,
                uptime_seconds: 0,
              },
              created_at: now,
              updated_at: now,
            };
            state.streaming.plotData[event.stream_id] = {
              dataChunks: [],
              ddaResults: [],
              maxBufferSize: 100,
            };
          } else {
            session.state = event.state;
            session.updated_at = Date.now() / 1000;
          }
        });
        break;

      case "stats_update":
        set((state) => {
          const session = state.streaming.sessions[event.stream_id];
          if (session) {
            session.stats = event.stats;
            session.updated_at = Date.now() / 1000;
          }
        });
        break;

      case "error":
        set((state) => {
          const session = state.streaming.sessions[event.stream_id];
          if (session) {
            session.state = {
              type: "Error",
              data: { message: event.error },
            };
          }
        });
        break;

      case "data_received":
      case "results_ready":
        break;
    }
  },

  addToStreamHistory: (sourceConfig, ddaConfig) => {
    set((state) => {
      let displayName = "";
      switch (sourceConfig.type) {
        case "file":
          const fileName = sourceConfig.path.split("/").pop() || "File";
          displayName = `File: ${fileName}`;
          break;
        case "websocket":
          displayName = `WebSocket: ${sourceConfig.url}`;
          break;
        case "tcp":
          displayName = `TCP: ${sourceConfig.host}:${sourceConfig.port}`;
          break;
        case "udp":
          displayName = `UDP: ${sourceConfig.bind_address}:${sourceConfig.port}`;
          break;
        case "serial":
          displayName = `Serial: ${sourceConfig.port}`;
          break;
      }

      const historyEntry = {
        id: `history-${crypto.randomUUID()}`,
        sourceConfig,
        ddaConfig,
        timestamp: Date.now(),
        displayName,
      };

      state.streaming.ui.recentSources.unshift(historyEntry);

      if (state.streaming.ui.recentSources.length > 10) {
        state.streaming.ui.recentSources =
          state.streaming.ui.recentSources.slice(0, 10);
      }
    });
  },

  createStreamFromHistory: async (historyId) => {
    const state = get();
    const historyEntry = state.streaming.ui.recentSources.find(
      (entry) => entry.id === historyId,
    );

    if (!historyEntry) {
      throw new Error("History entry not found");
    }

    return state.createStreamSession(
      historyEntry.sourceConfig,
      historyEntry.ddaConfig,
    );
  },

  removeFromStreamHistory: (historyId) => {
    set((state) => {
      state.streaming.ui.recentSources =
        state.streaming.ui.recentSources.filter(
          (entry) => entry.id !== historyId,
        );
    });
  },
});
