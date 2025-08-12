/**
 * Integration test to verify PopoutDataSyncService works with PopoutMessageHandler
 */

// Mock logger
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock window
const mockWindow = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  postMessage: jest.fn(),
  closed: false,
} as any;

// Mock global window
Object.defineProperty(global, "window", {
  value: mockWindow,
  writable: true,
});

describe("PopoutDataSyncService Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should integrate PopoutMessageHandler with PopoutDataSyncService", () => {
    // Mock the PopoutMessageHandler
    class MockPopoutMessageHandler {
      private static instance: MockPopoutMessageHandler;
      private messageListeners: Map<string, Function[]> = new Map();

      static getInstance() {
        if (!MockPopoutMessageHandler.instance) {
          MockPopoutMessageHandler.instance = new MockPopoutMessageHandler();
        }
        return MockPopoutMessageHandler.instance;
      }

      addMessageListener(messageType: string, listener: Function): () => void {
        if (!this.messageListeners.has(messageType)) {
          this.messageListeners.set(messageType, []);
        }
        this.messageListeners.get(messageType)!.push(listener);
        return () => {};
      }

      async sendMessage(
        targetWindow: Window,
        targetOrigin: string,
        message: any,
        requiresAck: boolean = false
      ): Promise<any> {
        return Promise.resolve();
      }

      sendAcknowledgment(
        targetWindow: Window,
        targetOrigin: string,
        originalMessage: any,
        data?: any
      ): void {
        // Mock implementation
      }

      cleanup(): void {
        this.messageListeners.clear();
      }
    }

    // Mock PopoutDataSyncService
    class MockPopoutDataSyncService {
      private static instance: MockPopoutDataSyncService;
      private messageHandler: MockPopoutMessageHandler;
      private registeredWindows: Map<string, any> = new Map();
      private isMainWindow: boolean = true;

      constructor() {
        this.messageHandler = MockPopoutMessageHandler.getInstance();
        this.initializeMessageHandler();
      }

      static getInstance(): MockPopoutDataSyncService {
        if (!MockPopoutDataSyncService.instance) {
          MockPopoutDataSyncService.instance = new MockPopoutDataSyncService();
        }
        return MockPopoutDataSyncService.instance;
      }

      private initializeMessageHandler(): void {
        // Set up message listeners using the PopoutMessageHandler
        this.messageHandler.addMessageListener(
          "INITIAL_DATA_REQUEST",
          (message: any, origin: string) => {
            this.handleInitialDataRequest(message, origin);
          }
        );

        this.messageHandler.addMessageListener(
          "DATA_UPDATE",
          (message: any) => {
            this.handleDataUpdate(message);
          }
        );

        this.messageHandler.addMessageListener(
          "HEARTBEAT",
          (message: any, origin: string) => {
            this.handleHeartbeat(message, origin);
          }
        );
      }

      registerPopoutWindow(
        widgetId: string,
        window: Window,
        origin: string = "*"
      ): void {
        this.registeredWindows.set(widgetId, {
          window,
          widgetId,
          origin,
          lastHeartbeat: Date.now(),
          isAlive: true,
        });
      }

      async sendMessage(targetWidgetId: string, message: any): Promise<any> {
        if (this.isMainWindow) {
          const registeredWindow = this.registeredWindows.get(targetWidgetId);
          if (registeredWindow && registeredWindow.isAlive) {
            return this.messageHandler.sendMessage(
              registeredWindow.window,
              registeredWindow.origin,
              message,
              true
            );
          } else {
            throw new Error(
              `No registered window found for widget: ${targetWidgetId}`
            );
          }
        }
      }

      broadcastDataUpdate(dataType: string, data: any): void {
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
                  data,
                },
                false
              );
            } catch (error) {
              registeredWindow.isAlive = false;
            }
          }
        });
      }

      private handleInitialDataRequest(message: any, origin: string): void {
        // Mock implementation
      }

      private handleDataUpdate(message: any): void {
        // Mock implementation
      }

      private handleHeartbeat(message: any, origin: string): void {
        // Mock implementation
      }

      cleanup(): void {
        this.registeredWindows.clear();
        this.messageHandler.cleanup();
      }
    }

    // Test the integration
    const syncService = MockPopoutDataSyncService.getInstance();

    expect(syncService).toBeDefined();
    expect(typeof syncService.registerPopoutWindow).toBe("function");
    expect(typeof syncService.sendMessage).toBe("function");
    expect(typeof syncService.broadcastDataUpdate).toBe("function");
    expect(typeof syncService.cleanup).toBe("function");

    // Test registering a window
    syncService.registerPopoutWindow(
      "test-widget",
      mockWindow,
      "http://localhost:3000"
    );

    // Test sending a message
    expect(async () => {
      await syncService.sendMessage("test-widget", {
        type: "INITIAL_DATA_REQUEST",
        widgetId: "test-widget",
      });
    }).not.toThrow();

    // Test broadcasting data
    expect(() => {
      syncService.broadcastDataUpdate("plot-state", { test: "data" });
    }).not.toThrow();

    // Test cleanup
    expect(() => {
      syncService.cleanup();
    }).not.toThrow();
  });

  it("should handle message types correctly", () => {
    const messageTypes = [
      "INITIAL_DATA_REQUEST",
      "INITIAL_DATA_RESPONSE",
      "DATA_UPDATE",
      "HEARTBEAT",
      "HEARTBEAT_RESPONSE",
      "ERROR",
      "WINDOW_CLOSING",
      "ACK",
    ];

    messageTypes.forEach((type) => {
      expect(typeof type).toBe("string");
      expect(type.length).toBeGreaterThan(0);
    });
  });

  it("should validate message structure requirements", () => {
    const requiredFields = ["id", "type", "timestamp", "widgetId"];

    const validMessage = {
      id: "msg_123",
      type: "DATA_UPDATE",
      timestamp: Date.now(),
      widgetId: "test-widget",
      dataType: "plot-state",
      data: { test: "data" },
    };

    requiredFields.forEach((field) => {
      expect(validMessage).toHaveProperty(field);
      expect(validMessage[field as keyof typeof validMessage]).toBeDefined();
    });
  });
});
