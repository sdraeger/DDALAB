// Import the actual implementation by bypassing the mock
const actualSharedPath = require.resolve(
  "../../../shared/services/PopoutMessageHandler.ts"
);
const { PopoutMessageHandler } = require(actualSharedPath);
import type { PopoutMessage } from "shared/services/PopoutMessageHandler";

// Mock logger
jest.mock("shared/lib/utils/logger", () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Mock window.postMessage
const mockPostMessage = jest.fn();
const mockWindow = {
  postMessage: mockPostMessage,
  closed: false,
} as any;

// Mock MessageEvent
class MockMessageEvent {
  constructor(
    public type: string,
    public data: any,
    public origin: string = "http://localhost:3000",
    public source: any = mockWindow
  ) {}
}

describe("PopoutMessageHandler", () => {
  let messageHandler: PopoutMessageHandler;
  let originalAddEventListener: any;
  let originalRemoveEventListener: any;
  let messageEventListener: (event: MessageEvent) => void;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    mockPostMessage.mockClear();

    // Mock window event listeners
    originalAddEventListener = window.addEventListener;
    originalRemoveEventListener = window.removeEventListener;

    window.addEventListener = jest.fn((event, listener) => {
      if (event === "message") {
        messageEventListener = listener as (event: MessageEvent) => void;
      }
    });

    window.removeEventListener = jest.fn();

    // Create new instance for each test
    (PopoutMessageHandler as any).instance = null;
    messageHandler = PopoutMessageHandler.getInstance({
      maxRetries: 2,
      retryDelay: 100,
      ackTimeout: 1000,
      queueProcessInterval: 50,
      maxQueueSize: 10,
    });
  });

  afterEach(() => {
    messageHandler.cleanup();
    window.addEventListener = originalAddEventListener;
    window.removeEventListener = originalRemoveEventListener;
  });

  describe("Message Sending", () => {
    it("should send a message without acknowledgment", async () => {
      const message = {
        type: "DATA_UPDATE",
        widgetId: "test-widget",
        dataType: "plot-state",
        data: { test: "data" },
      };

      await messageHandler.sendMessage(
        mockWindow,
        "http://localhost:3000",
        message,
        false
      );

      // Wait for queue processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "DATA_UPDATE",
          widgetId: "test-widget",
          dataType: "plot-state",
          data: { test: "data" },
          id: expect.any(String),
          timestamp: expect.any(Number),
          requiresAck: false,
        }),
        "http://localhost:3000"
      );
    });

    it("should send a message with acknowledgment requirement", async () => {
      const message = {
        type: "INITIAL_DATA_REQUEST",
        widgetId: "test-widget",
      };

      const sendPromise = messageHandler.sendMessage(
        mockWindow,
        "http://localhost:3000",
        message,
        true
      );

      // Wait for queue processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "INITIAL_DATA_REQUEST",
          widgetId: "test-widget",
          id: expect.any(String),
          timestamp: expect.any(Number),
          requiresAck: true,
        }),
        "http://localhost:3000"
      );

      // Simulate acknowledgment
      const sentMessage = mockPostMessage.mock.calls[0][0];
      const ackMessage = {
        id: "ack-123",
        type: "ACK",
        timestamp: Date.now(),
        widgetId: "test-widget",
        isAck: true,
        ackId: sentMessage.id,
        data: { success: true },
      };

      messageEventListener(new MockMessageEvent("message", ackMessage) as any);

      const result = await sendPromise;
      expect(result).toEqual({ success: true });
    });

    it("should timeout when acknowledgment is not received", async () => {
      const message = {
        type: "INITIAL_DATA_REQUEST",
        widgetId: "test-widget",
      };

      const sendPromise = messageHandler.sendMessage(
        mockWindow,
        "http://localhost:3000",
        message,
        true
      );

      await expect(sendPromise).rejects.toThrow(
        "Message acknowledgment timeout: INITIAL_DATA_REQUEST"
      );
    });

    it("should retry failed messages", async () => {
      // Make postMessage fail initially
      mockPostMessage
        .mockImplementationOnce(() => {
          throw new Error("Network error");
        })
        .mockImplementationOnce(() => {
          throw new Error("Network error");
        })
        .mockImplementation(() => {}); // Success on third try

      const message = {
        type: "DATA_UPDATE",
        widgetId: "test-widget",
        dataType: "plot-state",
        data: { test: "data" },
      };

      await messageHandler.sendMessage(
        mockWindow,
        "http://localhost:3000",
        message,
        false
      );

      // Wait for retries
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(mockPostMessage).toHaveBeenCalledTimes(3);
    });

    it("should fail after max retries", async () => {
      // Make postMessage always fail
      mockPostMessage.mockImplementation(() => {
        throw new Error("Network error");
      });

      const message = {
        type: "INITIAL_DATA_REQUEST",
        widgetId: "test-widget",
      };

      const sendPromise = messageHandler.sendMessage(
        mockWindow,
        "http://localhost:3000",
        message,
        true
      );

      await expect(sendPromise).rejects.toThrow(
        "Message delivery failed after max retries"
      );

      // Should have tried maxRetries + 1 times (initial + retries)
      expect(mockPostMessage).toHaveBeenCalledTimes(3);
    });
  });

  describe("Message Receiving", () => {
    it("should handle incoming messages and notify listeners", async () => {
      const listener = jest.fn();
      const unsubscribe = messageHandler.addMessageListener(
        "DATA_UPDATE",
        listener
      );

      const incomingMessage: PopoutMessage = {
        id: "msg-123",
        type: "DATA_UPDATE",
        timestamp: Date.now(),
        widgetId: "test-widget",
        dataType: "plot-state",
        data: { test: "data" },
      } as any;

      messageEventListener(
        new MockMessageEvent("message", incomingMessage) as any
      );

      expect(listener).toHaveBeenCalledWith(
        incomingMessage,
        "http://localhost:3000"
      );

      unsubscribe();
    });

    it("should send acknowledgment for messages that require it", async () => {
      const incomingMessage: PopoutMessage = {
        id: "msg-123",
        type: "INITIAL_DATA_REQUEST",
        timestamp: Date.now(),
        widgetId: "test-widget",
        requiresAck: true,
      } as any;

      messageEventListener(
        new MockMessageEvent("message", incomingMessage) as any
      );

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ACK",
          isAck: true,
          ackId: "msg-123",
          widgetId: "test-widget",
        }),
        "http://localhost:3000"
      );
    });

    it("should ignore invalid messages", async () => {
      const listener = jest.fn();
      messageHandler.addMessageListener("DATA_UPDATE", listener);

      // Send invalid message
      messageEventListener(
        new MockMessageEvent("message", { invalid: "message" }) as any
      );

      expect(listener).not.toHaveBeenCalled();
    });

    it("should handle multiple listeners for the same message type", async () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      messageHandler.addMessageListener("DATA_UPDATE", listener1);
      messageHandler.addMessageListener("DATA_UPDATE", listener2);

      const incomingMessage: PopoutMessage = {
        id: "msg-123",
        type: "DATA_UPDATE",
        timestamp: Date.now(),
        widgetId: "test-widget",
        dataType: "plot-state",
        data: { test: "data" },
      } as any;

      messageEventListener(
        new MockMessageEvent("message", incomingMessage) as any
      );

      expect(listener1).toHaveBeenCalledWith(
        incomingMessage,
        "http://localhost:3000"
      );
      expect(listener2).toHaveBeenCalledWith(
        incomingMessage,
        "http://localhost:3000"
      );
    });
  });

  describe("Queue Management", () => {
    it("should provide queue statistics", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      messageHandler.addMessageListener("DATA_UPDATE", listener1);
      messageHandler.addMessageListener("HEARTBEAT", listener2);

      const stats = messageHandler.getQueueStats();

      expect(stats.totalListeners).toBe(2);
      expect(stats.queueSize).toBe(0);
      expect(stats.pendingAcks).toBe(0);
    });

    it("should clear the message queue", async () => {
      // Queue some messages
      await messageHandler.sendMessage(
        mockWindow,
        "http://localhost:3000",
        { type: "DATA_UPDATE", widgetId: "test", dataType: "test", data: {} },
        false
      );

      let stats = messageHandler.getQueueStats();
      expect(stats.queueSize).toBeGreaterThan(0);

      messageHandler.clearQueue();

      stats = messageHandler.getQueueStats();
      expect(stats.queueSize).toBe(0);
    });

    it("should reject messages when queue is full", async () => {
      // Fill the queue to max capacity
      const promises = [];
      for (let i = 0; i < 11; i++) {
        // maxQueueSize is 10
        promises.push(
          messageHandler.sendMessage(
            mockWindow,
            "http://localhost:3000",
            {
              type: "DATA_UPDATE",
              widgetId: `test-${i}`,
              dataType: "test",
              data: {},
            },
            false
          )
        );
      }

      // The 11th message should be rejected
      await expect(promises[10]).rejects.toThrow("Message queue is full");
    });
  });

  describe("Cleanup", () => {
    it("should cleanup all resources", () => {
      const listener = jest.fn();
      messageHandler.addMessageListener("DATA_UPDATE", listener);

      messageHandler.cleanup();

      const stats = messageHandler.getQueueStats();
      expect(stats.totalListeners).toBe(0);
      expect(stats.queueSize).toBe(0);
      expect(stats.pendingAcks).toBe(0);

      expect(window.removeEventListener).toHaveBeenCalledWith(
        "message",
        expect.any(Function)
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle closed target windows gracefully", async () => {
      const closedWindow = { ...mockWindow, closed: true };

      const message = {
        type: "DATA_UPDATE",
        widgetId: "test-widget",
        dataType: "plot-state",
        data: { test: "data" },
      };

      await messageHandler.sendMessage(
        closedWindow,
        "http://localhost:3000",
        message,
        false
      );

      // Wait for queue processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not attempt to send to closed window
      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it("should handle listener errors gracefully", async () => {
      const errorListener = jest.fn().mockImplementation(() => {
        throw new Error("Listener error");
      });
      const normalListener = jest.fn();

      messageHandler.addMessageListener("DATA_UPDATE", errorListener);
      messageHandler.addMessageListener("DATA_UPDATE", normalListener);

      const incomingMessage: PopoutMessage = {
        id: "msg-123",
        type: "DATA_UPDATE",
        timestamp: Date.now(),
        widgetId: "test-widget",
        dataType: "plot-state",
        data: { test: "data" },
      } as any;

      messageEventListener(
        new MockMessageEvent("message", incomingMessage) as any
      );

      // Both listeners should be called despite the error
      expect(errorListener).toHaveBeenCalled();
      expect(normalListener).toHaveBeenCalled();
    });
  });
});
