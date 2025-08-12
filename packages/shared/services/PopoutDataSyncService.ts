"use client";

import logger from "../lib/utils/logger";
import type { PlotsState, PlotState } from "../store/slices/plotSlice";
import type { RootState } from "../store/rootReducer";
import type { EEGData } from "../types/EEGData";
import {
  PopoutMessageHandler,
  type PopoutMessage,
  type DataUpdateMessage,
  type InitialDataRequestMessage,
  type InitialDataResponseMessage,
  type ErrorMessage,
} from "./PopoutMessageHandler";

// Additional data types for popout synchronization
export interface PopoutSyncData {
  type:
    | "INITIAL_DATA_REQUEST"
    | "INITIAL_DATA_RESPONSE"
    | "DATA_UPDATE"
    | "HEARTBEAT"
    | "HEARTBEAT_RESPONSE"
    | "ERROR"
    | "WINDOW_CLOSING";
  widgetId: string;
  timestamp: number;
  data?: any;
  error?: string;
  messageId?: string;
}

// Initial data structure sent to popout windows
export interface PopoutInitialData {
  plotsState: PlotsState;
  authToken: string | null;
  sessionData: any;
  widgetSpecificData: Record<string, any>;
  userPreferences?: any;
  timestamp: number;
}

// Window registration information
interface RegisteredWindow {
  window: Window;
  widgetId: string;
  origin: string;
  lastHeartbeat: number;
  isAlive: boolean;
}

// Data serialization options
interface SerializationOptions {
  compressEdfData?: boolean;
  maxDataSize?: number;
  includeRawData?: boolean;
}

// Message acknowledgment tracking
interface PendingMessage {
  messageId: string;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

/**
 * Enhanced data synchronization service for popout windows
 * Handles message passing, window registration, and data serialization
 */
export class PopoutDataSyncService {
  private static instance: PopoutDataSyncService;
  private registeredWindows: Map<string, RegisteredWindow> = new Map();
  private messageListeners: Map<string, (data: any) => void> = new Map();
  private pendingMessages: Map<string, PendingMessage> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isMainWindow: boolean = true;
  private parentWindow: Window | null = null;
  private parentOrigin: string | null = null;
  private messageHandler: PopoutMessageHandler;

  // Configuration
  private readonly HEARTBEAT_INTERVAL = 5000; // 5 seconds
  private readonly MESSAGE_TIMEOUT = 10000; // 10 seconds
  private readonly MAX_RETRIES = 3;
  private readonly MAX_DATA_SIZE = 50 * 1024 * 1024; // 50MB

  private constructor() {
    this.messageHandler = PopoutMessageHandler.getInstance();
    this.initializeMessageHandler();
    this.startHeartbeat();
  }

  public static getInstance(): PopoutDataSyncService {
    if (!PopoutDataSyncService.instance) {
      PopoutDataSyncService.instance = new PopoutDataSyncService();
    }
    return PopoutDataSyncService.instance;
  }

  /**
   * Initialize the service for a popout window
   */
  public initializeAsPopout(parentWindow: Window, parentOrigin: string): void {
    this.isMainWindow = false;
    this.parentWindow = parentWindow;
    this.parentOrigin = parentOrigin;

    logger.info("[PopoutDataSyncService] Initialized as popout window", {
      parentOrigin,
    });
  }

  /**
   * Register a popout window for data synchronization
   */
  public registerPopoutWindow(
    widgetId: string,
    window: Window,
    origin: string = "*"
  ): void {
    if (!this.isMainWindow) {
      logger.warn(
        "[PopoutDataSyncService] Cannot register windows from popout"
      );
      return;
    }

    const registeredWindow: RegisteredWindow = {
      window,
      widgetId,
      origin,
      lastHeartbeat: Date.now(),
      isAlive: true,
    };

    this.registeredWindows.set(widgetId, registeredWindow);

    logger.info("[PopoutDataSyncService] Registered popout window", {
      widgetId,
      origin,
      totalWindows: this.registeredWindows.size,
    });

    // Send initial heartbeat
    this.sendHeartbeat(widgetId);
  }

  /**
   * Unregister a popout window
   */
  public unregisterPopoutWindow(widgetId: string): void {
    const removed = this.registeredWindows.delete(widgetId);

    if (removed) {
      logger.info("[PopoutDataSyncService] Unregistered popout window", {
        widgetId,
        remainingWindows: this.registeredWindows.size,
      });
    }
  }

  /**
   * Send a message to a specific popout window or parent window
   */
  public async sendMessage(
    targetWidgetId: string,
    message: Omit<PopoutMessage, "timestamp" | "id">
  ): Promise<any> {
    if (this.isMainWindow) {
      // Send to popout window
      const registeredWindow = this.registeredWindows.get(targetWidgetId);
      if (registeredWindow && registeredWindow.isAlive) {
        return this.messageHandler.sendMessage(
          registeredWindow.window,
          registeredWindow.origin,
          message,
          true // Require acknowledgment for reliability
        );
      } else {
        throw new Error(
          `No registered window found for widget: ${targetWidgetId}`
        );
      }
    } else {
      // Send to parent window
      if (this.parentWindow && this.parentOrigin) {
        return this.messageHandler.sendMessage(
          this.parentWindow,
          this.parentOrigin,
          message,
          true // Require acknowledgment for reliability
        );
      } else {
        throw new Error("Parent window not available");
      }
    }
  }

  /**
   * Broadcast data update to all registered popout windows
   */
  public broadcastDataUpdate(dataType: string, data: any): void {
    if (!this.isMainWindow) {
      logger.warn(
        "[PopoutDataSyncService] Cannot broadcast from popout window"
      );
      return;
    }

    const serializedData = this.serializeData(data, { compressEdfData: true });

    logger.info("[PopoutDataSyncService] Broadcasting data update", {
      dataType,
      windowCount: this.registeredWindows.size,
      dataSize: JSON.stringify(serializedData).length,
    });

    this.registeredWindows.forEach(async (registeredWindow, widgetId) => {
      if (registeredWindow.isAlive) {
        try {
          await this.messageHandler.sendMessage(
            registeredWindow.window,
            registeredWindow.origin,
            {
              type: "DATA_UPDATE",
              widgetId,
              dataType,
              data: serializedData,
            } as Omit<DataUpdateMessage, "id" | "timestamp">,
            false // Don't require acknowledgment for broadcasts to improve performance
          );
        } catch (error) {
          logger.error(
            "[PopoutDataSyncService] Failed to broadcast to window",
            {
              widgetId,
              error: error instanceof Error ? error.message : error,
            }
          );
          // Mark window as potentially dead
          registeredWindow.isAlive = false;
        }
      }
    });
  }

  /**
   * Request initial data from main window (called from popout)
   */
  public async requestInitialData(
    widgetId: string
  ): Promise<PopoutInitialData> {
    if (this.isMainWindow) {
      throw new Error("Cannot request initial data from main window");
    }

    if (!this.parentWindow) {
      throw new Error("Parent window not available");
    }

    logger.info("[PopoutDataSyncService] Requesting initial data", {
      widgetId,
    });

    return this.sendMessage(widgetId, {
      type: "INITIAL_DATA_REQUEST",
      widgetId,
    });
  }

  /**
   * Subscribe to data updates
   */
  public subscribeToDataUpdates(
    dataType: string,
    callback: (data: any) => void
  ): () => void {
    const key = `${dataType}`;
    this.messageListeners.set(key, callback);

    logger.info("[PopoutDataSyncService] Subscribed to data updates", {
      dataType,
    });

    return () => {
      this.messageListeners.delete(key);
      logger.info("[PopoutDataSyncService] Unsubscribed from data updates", {
        dataType,
      });
    };
  }

  /**
   * Serialize data for transmission between windows
   */
  public serializeData(data: any, options: SerializationOptions = {}): any {
    const {
      compressEdfData = false,
      maxDataSize = this.MAX_DATA_SIZE,
      includeRawData = true,
    } = options;

    try {
      if (!data) return null;

      // Handle PlotsState serialization
      if (this.isPlotsState(data)) {
        return this.serializePlotsState(data, {
          compressEdfData,
          includeRawData,
        });
      }

      // Handle EEGData serialization
      if (this.isEEGData(data)) {
        return this.serializeEEGData(data, { compressEdfData });
      }

      // Handle generic objects
      const serialized = JSON.parse(JSON.stringify(data));
      const serializedSize = JSON.stringify(serialized).length;

      if (serializedSize > maxDataSize) {
        logger.warn("[PopoutDataSyncService] Data size exceeds limit", {
          size: serializedSize,
          maxSize: maxDataSize,
        });

        // Return a truncated version or throw error
        throw new Error(
          `Data size (${serializedSize}) exceeds maximum (${maxDataSize})`
        );
      }

      return serialized;
    } catch (error) {
      logger.error("[PopoutDataSyncService] Failed to serialize data", {
        error: error instanceof Error ? error.message : error,
        dataType: typeof data,
      });
      throw error;
    }
  }

  /**
   * Deserialize data received from other windows
   */
  public deserializeData(serializedData: any): any {
    try {
      if (!serializedData) return null;

      // Handle compressed EDF data
      if (serializedData._type === "EEGData" && serializedData._compressed) {
        return this.deserializeEEGData(serializedData);
      }

      // Handle PlotsState
      if (serializedData._type === "PlotsState") {
        return this.deserializePlotsState(serializedData);
      }

      return serializedData;
    } catch (error) {
      logger.error("[PopoutDataSyncService] Failed to deserialize data", {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Get connection health status
   */
  public getConnectionHealth(): {
    isConnected: boolean;
    registeredWindows: number;
    lastHeartbeat?: number;
  } {
    if (this.isMainWindow) {
      const aliveWindows = Array.from(this.registeredWindows.values()).filter(
        (w) => w.isAlive
      ).length;

      return {
        isConnected: true,
        registeredWindows: aliveWindows,
      };
    } else {
      const lastHeartbeat = this.parentWindow ? Date.now() : undefined;
      return {
        isConnected: !!this.parentWindow,
        registeredWindows: 0,
        lastHeartbeat,
      };
    }
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    // Clear heartbeat interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Clear pending messages
    this.pendingMessages.forEach((pending) => {
      pending.reject(new Error("Service cleanup"));
    });
    this.pendingMessages.clear();

    // Clear registered windows
    this.registeredWindows.clear();

    // Clear message listeners
    this.messageListeners.clear();

    // Cleanup message handler
    this.messageHandler.cleanup();

    logger.info("[PopoutDataSyncService] Cleanup completed");
  }

  // Private methods

  private initializeMessageHandler(): void {
    if (typeof window === "undefined") return;

    // Set up message listeners using the PopoutMessageHandler
    this.messageHandler.addMessageListener(
      "INITIAL_DATA_REQUEST",
      (message, origin) => {
        this.handleInitialDataRequest(message as any, origin);
      }
    );

    this.messageHandler.addMessageListener(
      "INITIAL_DATA_RESPONSE",
      (message) => {
        this.handleInitialDataResponse(message as any);
      }
    );

    this.messageHandler.addMessageListener("DATA_UPDATE", (message) => {
      this.handleDataUpdate(message as any);
    });

    this.messageHandler.addMessageListener("HEARTBEAT", (message, origin) => {
      this.handleHeartbeat(message as any, origin);
    });

    this.messageHandler.addMessageListener("HEARTBEAT_RESPONSE", (message) => {
      this.handleHeartbeatResponse(message as any);
    });

    this.messageHandler.addMessageListener("ERROR", (message) => {
      this.handleError(message as any);
    });

    this.messageHandler.addMessageListener("WINDOW_CLOSING", (message) => {
      this.handleWindowClosing(message as any);
    });

    window.addEventListener("beforeunload", () => this.handleWindowClosing());
  }

  private handleInitialDataRequest(
    message: PopoutMessage,
    origin: string
  ): void {
    if (!this.isMainWindow) return;

    try {
      // Get current Redux state
      const reduxStore = (window as any).__REDUX_STORE__;
      const state: RootState = reduxStore?.getState();

      if (!state) {
        throw new Error("Redux store not available");
      }

      // Get authentication data
      const authToken = this.getAuthToken();
      const sessionData = this.getSessionData();

      const initialData: PopoutInitialData = {
        plotsState: state.plots,
        authToken,
        sessionData,
        widgetSpecificData: this.getWidgetSpecificData(message.widgetId),
        userPreferences: this.getUserPreferences(),
        timestamp: Date.now(),
      };

      const serializedData = this.serializeData(initialData);

      // Send response using message handler
      const registeredWindow = this.registeredWindows.get(message.widgetId);
      if (registeredWindow) {
        this.messageHandler.sendAcknowledgment(
          registeredWindow.window,
          registeredWindow.origin,
          message,
          serializedData
        );
      }

      logger.info("[PopoutDataSyncService] Sent initial data response", {
        widgetId: message.widgetId,
        dataSize: JSON.stringify(serializedData).length,
      });
    } catch (error) {
      logger.error(
        "[PopoutDataSyncService] Failed to handle initial data request",
        {
          error: error instanceof Error ? error.message : error,
          widgetId: message.widgetId,
        }
      );

      const registeredWindow = this.registeredWindows.get(message.widgetId);
      if (registeredWindow) {
        this.messageHandler.sendMessage(
          registeredWindow.window,
          registeredWindow.origin,
          {
            type: "ERROR",
            widgetId: message.widgetId,
            error: error instanceof Error ? error.message : "Unknown error",
          } as Omit<ErrorMessage, "id" | "timestamp">,
          false
        );
      }
    }
  }

  private handleInitialDataResponse(message: any): void {
    if (this.isMainWindow) return;

    // The PopoutMessageHandler now handles acknowledgments automatically
    // This method is kept for compatibility but the actual response handling
    // is done through the message handler's acknowledgment system
    logger.debug("[PopoutDataSyncService] Received initial data response", {
      widgetId: message.widgetId,
    });
  }

  private handleDataUpdate(message: PopoutMessage): void {
    if (message.type !== "DATA_UPDATE") return;

    const dataMessage = message as DataUpdateMessage;
    const { data } = dataMessage;
    if (!data || !dataMessage.dataType) return;

    const listener = this.messageListeners.get(dataMessage.dataType);
    if (listener) {
      const deserializedPayload = this.deserializeData(data);
      listener(deserializedPayload);
    }
  }

  private handleHeartbeat(message: PopoutMessage, origin: string): void {
    if (!this.isMainWindow) return;

    const registeredWindow = this.registeredWindows.get(message.widgetId);
    if (registeredWindow) {
      registeredWindow.lastHeartbeat = Date.now();
      registeredWindow.isAlive = true;

      // Send heartbeat response
      this.messageHandler.sendMessage(
        registeredWindow.window,
        registeredWindow.origin,
        {
          type: "HEARTBEAT_RESPONSE",
          widgetId: message.widgetId,
        },
        false
      );
    }
  }

  private handleHeartbeatResponse(message: PopoutMessage): void {
    // Update connection status for popout window
    logger.debug("[PopoutDataSyncService] Received heartbeat response", {
      widgetId: message.widgetId,
    });
  }

  private handleError(message: any): void {
    logger.error("[PopoutDataSyncService] Received error message", {
      widgetId: message.widgetId,
      error: message.error,
    });

    // Error handling is now managed by the PopoutMessageHandler
    // This method is kept for logging and any additional error processing
  }

  private handleWindowClosing(message?: PopoutMessage): void {
    if (message) {
      this.unregisterPopoutWindow(message.widgetId);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.isMainWindow) {
        // Check for dead windows
        this.registeredWindows.forEach((registeredWindow, widgetId) => {
          const timeSinceLastHeartbeat =
            Date.now() - registeredWindow.lastHeartbeat;
          if (timeSinceLastHeartbeat > this.HEARTBEAT_INTERVAL * 3) {
            registeredWindow.isAlive = false;
            logger.warn("[PopoutDataSyncService] Window appears to be dead", {
              widgetId,
              timeSinceLastHeartbeat,
            });
          }
        });
      } else {
        // Send heartbeat to parent
        if (this.parentWindow && this.parentOrigin) {
          this.messageHandler
            .sendMessage(
              this.parentWindow,
              this.parentOrigin,
              {
                type: "HEARTBEAT",
                widgetId: "popout",
              },
              false
            )
            .catch((error) => {
              logger.warn(
                "[PopoutDataSyncService] Failed to send heartbeat to parent",
                {
                  error: error instanceof Error ? error.message : error,
                }
              );
            });
        }
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private sendHeartbeat(widgetId: string): void {
    const registeredWindow = this.registeredWindows.get(widgetId);
    if (registeredWindow && registeredWindow.isAlive) {
      this.messageHandler
        .sendMessage(
          registeredWindow.window,
          registeredWindow.origin,
          {
            type: "HEARTBEAT",
            widgetId,
          },
          false
        )
        .catch((error) => {
          logger.warn("[PopoutDataSyncService] Failed to send heartbeat", {
            widgetId,
            error: error instanceof Error ? error.message : error,
          });
          registeredWindow.isAlive = false;
        });
    }
  }

  private isPlotsState(data: any): data is PlotsState {
    return (
      data &&
      typeof data === "object" &&
      "byFilePath" in data &&
      "currentFilePath" in data
    );
  }

  private isEEGData(data: any): data is EEGData {
    return (
      data &&
      typeof data === "object" &&
      "data" in data &&
      "channels" in data &&
      "sampleRate" in data
    );
  }

  private serializePlotsState(
    plotsState: PlotsState,
    options: { compressEdfData?: boolean; includeRawData?: boolean }
  ): any {
    const serialized = {
      _type: "PlotsState",
      byFilePath: {} as Record<string, any>,
      currentFilePath: plotsState.currentFilePath,
    };

    Object.entries(plotsState.byFilePath).forEach(([filePath, plotState]) => {
      serialized.byFilePath[filePath] = {
        ...plotState,
        edfData: plotState.edfData
          ? this.serializeEEGData(plotState.edfData, options)
          : null,
      };
    });

    return serialized;
  }

  private deserializePlotsState(serializedData: any): PlotsState {
    const plotsState: PlotsState = {
      byFilePath: {},
      currentFilePath: serializedData.currentFilePath,
    };

    Object.entries(serializedData.byFilePath).forEach(
      ([filePath, plotState]: [string, any]) => {
        plotsState.byFilePath[filePath] = {
          ...plotState,
          edfData: plotState.edfData
            ? this.deserializeEEGData(plotState.edfData)
            : null,
        };
      }
    );

    return plotsState;
  }

  private serializeEEGData(
    eegData: EEGData,
    options: { compressEdfData?: boolean } = {}
  ): any {
    const { compressEdfData = false } = options;

    if (compressEdfData) {
      // For large datasets, we might want to implement compression
      // For now, we'll just mark it as compressed and include essential data
      return {
        _type: "EEGData",
        _compressed: true,
        channels: eegData.channels,
        sampleRate: eegData.sampleRate,
        duration: eegData.duration,
        samplesPerChannel: eegData.samplesPerChannel,
        startTime: eegData.startTime,
        annotations: eegData.annotations,
        // Include a subset of data or reference to fetch it
        dataSize: eegData.data?.length || 0,
        hasData: !!eegData.data,
      };
    }

    return {
      _type: "EEGData",
      ...eegData,
    };
  }

  private deserializeEEGData(serializedData: any): EEGData {
    if (serializedData._compressed) {
      // Handle compressed data - might need to request full data
      return {
        channels: serializedData.channels,
        sampleRate: serializedData.sampleRate,
        duration: serializedData.duration,
        samplesPerChannel: serializedData.samplesPerChannel,
        startTime: serializedData.startTime,
        annotations: serializedData.annotations,
        data: [], // Empty array instead of null to match EEGData type
      };
    }

    return {
      channels: serializedData.channels,
      sampleRate: serializedData.sampleRate,
      duration: serializedData.duration,
      samplesPerChannel: serializedData.samplesPerChannel,
      startTime: serializedData.startTime,
      annotations: serializedData.annotations,
      data: serializedData.data,
    };
  }

  private getAuthToken(): string | null {
    try {
      // Try to get from Redux store first
      const reduxStore = (window as any).__REDUX_STORE__;
      const state = reduxStore?.getState();

      if (state?.auth?.user?.accessToken) {
        return state.auth.user.accessToken;
      }

      // Try to get from unified session
      if (typeof window !== "undefined") {
        // Check for NextAuth session
        const nextAuthSession = sessionStorage.getItem(
          "next-auth.session-token"
        );
        if (nextAuthSession) {
          // For NextAuth, we need to get the actual session data
          const sessionData = sessionStorage.getItem("next-auth.session");
          if (sessionData) {
            const parsed = JSON.parse(sessionData);
            return parsed.accessToken || null;
          }
        }

        // Check for local mode token
        const localSession = localStorage.getItem("dda-local-session");
        if (localSession) {
          const parsed = JSON.parse(localSession);
          return parsed.accessToken || "local-mode-token";
        }

        // Check for auth mode context
        const authModeData = sessionStorage.getItem("auth-mode-context");
        if (authModeData) {
          const parsed = JSON.parse(authModeData);
          if (parsed.isLocalMode) {
            return "local-mode-token";
          }
        }
      }

      return null;
    } catch (error) {
      logger.warn("[PopoutDataSyncService] Failed to get auth token", {
        error,
      });
      return null;
    }
  }

  private getSessionData(): any {
    try {
      // Collect comprehensive session data
      const sessionData: any = {};

      // Get NextAuth session data
      const nextAuthSession = sessionStorage.getItem("next-auth.session");
      if (nextAuthSession) {
        sessionData.nextAuth = JSON.parse(nextAuthSession);
      }

      // Get local session data
      const localSession = localStorage.getItem("dda-local-session");
      if (localSession) {
        sessionData.localSession = JSON.parse(localSession);
      }

      // Get auth mode context
      const authModeData = sessionStorage.getItem("auth-mode-context");
      if (authModeData) {
        sessionData.authMode = JSON.parse(authModeData);
      }

      // Get user preferences
      const userPrefs = localStorage.getItem("dda-user-preferences");
      if (userPrefs) {
        sessionData.userPreferences = JSON.parse(userPrefs);
      }

      // Get any additional session storage items that might be relevant
      const sessionKeys = Object.keys(sessionStorage);
      sessionKeys.forEach((key) => {
        if (
          key.startsWith("dda-") ||
          key.startsWith("next-auth") ||
          key.includes("session")
        ) {
          try {
            const value = sessionStorage.getItem(key);
            if (value && !sessionData[key]) {
              sessionData[key] = JSON.parse(value);
            }
          } catch {
            // If it's not JSON, store as string
            sessionData[key] = sessionStorage.getItem(key);
          }
        }
      });

      return Object.keys(sessionData).length > 0 ? sessionData : null;
    } catch (error) {
      logger.warn("[PopoutDataSyncService] Failed to get session data", {
        error,
      });
      return null;
    }
  }

  private getWidgetSpecificData(widgetId: string): Record<string, any> {
    try {
      // Get widget-specific data from localStorage or other sources
      const widgetData = localStorage.getItem(`widget-data-${widgetId}`);
      return widgetData ? JSON.parse(widgetData) : {};
    } catch (error) {
      logger.warn(
        "[PopoutDataSyncService] Failed to get widget specific data",
        {
          error,
          widgetId,
        }
      );
      return {};
    }
  }

  private getUserPreferences(): any {
    try {
      const preferences = localStorage.getItem("user-preferences");
      return preferences ? JSON.parse(preferences) : null;
    } catch (error) {
      logger.warn("[PopoutDataSyncService] Failed to get user preferences", {
        error,
      });
      return null;
    }
  }
}

// Export singleton instance
export const popoutDataSyncService = PopoutDataSyncService.getInstance();
