import { Store } from "@reduxjs/toolkit";
import { RootState } from "./rootReducer";
import { validateStateIntegrity } from "./middleware/popoutSyncConfig";
import logger from "../lib/utils/logger";

export interface PopoutInitializationData {
  initialState: Partial<RootState>;
  widgetId: string;
  parentOrigin: string;
}

/**
 * Initializes a popout window's Redux store with data from the main window
 */
export class PopoutStoreInitializer {
  private store: Store<RootState>;
  private isInitialized: boolean = false;

  constructor(store: Store<RootState>) {
    this.store = store;
  }

  /**
   * Initialize the popout store with data from the main window
   */
  public async initializeFromMainWindow(
    widgetId: string,
    timeout: number = 5000
  ): Promise<boolean> {
    if (this.isInitialized) {
      logger.warn("[PopoutStoreInit] Store already initialized");
      return true;
    }

    try {
      // Request initial data from main window
      const initialData = await this.requestInitialData(widgetId, timeout);

      if (!initialData) {
        logger.error("[PopoutStoreInit] Failed to receive initial data");
        return false;
      }

      // Validate the received state
      if (!this.validateInitialData(initialData)) {
        logger.error("[PopoutStoreInit] Invalid initial data received");
        return false;
      }

      // Apply the initial state to the store
      this.applyInitialState(initialData.initialState);

      this.isInitialized = true;
      logger.info(
        `[PopoutStoreInit] Successfully initialized store for widget: ${widgetId}`
      );

      return true;
    } catch (error) {
      logger.error("[PopoutStoreInit] Error during initialization:", error);
      return false;
    }
  }

  /**
   * Request initial data from the main window
   */
  private requestInitialData(
    widgetId: string,
    timeout: number
  ): Promise<PopoutInitializationData | null> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        window.removeEventListener("message", messageHandler);
        resolve(null);
      }, timeout);

      const messageHandler = (event: MessageEvent) => {
        if (
          event.data?.type === "POPOUT_INITIAL_DATA_RESPONSE" &&
          event.data?.widgetId === widgetId
        ) {
          clearTimeout(timeoutId);
          window.removeEventListener("message", messageHandler);
          resolve(event.data.data);
        }
      };

      window.addEventListener("message", messageHandler);

      // Send request to main window
      if (window.opener) {
        window.opener.postMessage(
          {
            type: "POPOUT_INITIAL_DATA_REQUEST",
            widgetId,
            timestamp: Date.now(),
          },
          "*"
        );
      } else {
        clearTimeout(timeoutId);
        resolve(null);
      }
    });
  }

  /**
   * Validate the initial data received from main window
   */
  private validateInitialData(data: PopoutInitializationData): boolean {
    if (!data || typeof data !== "object") {
      return false;
    }

    if (!data.widgetId || typeof data.widgetId !== "string") {
      return false;
    }

    if (!data.parentOrigin || typeof data.parentOrigin !== "string") {
      return false;
    }

    if (!data.initialState || typeof data.initialState !== "object") {
      return false;
    }

    // Validate the state structure
    return validateStateIntegrity(data.initialState as RootState);
  }

  /**
   * Apply the initial state to the Redux store
   */
  private applyInitialState(initialState: Partial<RootState>): void {
    // Apply auth state
    if (initialState.auth) {
      this.store.dispatch({
        type: "auth/syncFromRemote",
        payload: initialState.auth,
        meta: { fromPopoutSync: true, isInitialization: true },
      });
    }

    // Apply plots state
    if (initialState.plots) {
      this.store.dispatch({
        type: "plots/syncFromRemote",
        payload: initialState.plots,
        meta: { fromPopoutSync: true, isInitialization: true },
      });
    }

    // Apply loading state
    if (initialState.loading) {
      this.store.dispatch({
        type: "loading/syncFromRemote",
        payload: initialState.loading,
        meta: { fromPopoutSync: true, isInitialization: true },
      });
    }

    logger.debug("[PopoutStoreInit] Applied initial state to store");
  }

  /**
   * Check if the store has been initialized
   */
  public isStoreInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Reset initialization state (for testing)
   */
  public reset(): void {
    this.isInitialized = false;
  }
}

/**
 * Main window handler for popout initialization requests
 */
export class MainWindowPopoutHandler {
  private store: Store<RootState>;

  constructor(store: Store<RootState>) {
    this.store = store;
    this.setupMessageHandler();
  }

  private setupMessageHandler(): void {
    if (typeof window !== "undefined") {
      window.addEventListener("message", this.handleMessage.bind(this));
    }
  }

  private handleMessage(event: MessageEvent): void {
    if (event.data?.type === "POPOUT_INITIAL_DATA_REQUEST") {
      this.handleInitialDataRequest(event);
    }
  }

  private handleInitialDataRequest(event: MessageEvent): void {
    const { widgetId } = event.data;

    if (!widgetId || !event.source) {
      logger.warn("[MainWindowPopoutHandler] Invalid initial data request");
      return;
    }

    try {
      const currentState = this.store.getState();
      const initialData: PopoutInitializationData = {
        initialState: this.extractInitialState(currentState),
        widgetId,
        parentOrigin: window.location.origin,
      };

      // Send response back to popout window
      (event.source as Window).postMessage(
        {
          type: "POPOUT_INITIAL_DATA_RESPONSE",
          widgetId,
          data: initialData,
          timestamp: Date.now(),
        },
        "*"
      );

      logger.info(
        `[MainWindowPopoutHandler] Sent initial data for widget: ${widgetId}`
      );
    } catch (error) {
      logger.error(
        "[MainWindowPopoutHandler] Error handling initial data request:",
        error
      );
    }
  }

  private extractInitialState(state: RootState): Partial<RootState> {
    return {
      auth: {
        ...state.auth,
        loading: false, // Don't sync loading state
      },
      plots: {
        ...state.plots,
        byFilePath: { ...state.plots.byFilePath },
      },
      loading: {
        ...state.loading,
        operations: {}, // Don't sync specific operations
        isGloballyLoading: false, // Will be recalculated
      },
    };
  }
}

// Utility function to initialize popout store
export const initializePopoutStore = async (
  store: Store<RootState>,
  widgetId: string,
  timeout?: number
): Promise<boolean> => {
  const initializer = new PopoutStoreInitializer(store);
  return initializer.initializeFromMainWindow(widgetId, timeout);
};

// Utility function to setup main window popout handler
export const setupMainWindowPopoutHandler = (
  store: Store<RootState>
): MainWindowPopoutHandler => {
  return new MainWindowPopoutHandler(store);
};
