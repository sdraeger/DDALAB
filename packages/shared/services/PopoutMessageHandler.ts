"use client";

import logger from "../lib/utils/logger";

// Type-safe message definitions
export interface BasePopoutMessage {
  id: string;
  type: string;
  timestamp: number;
  widgetId: string;
  requiresAck?: boolean;
  isAck?: boolean;
  ackId?: string;
}

export interface InitialDataRequestMessage extends BasePopoutMessage {
  type: "INITIAL_DATA_REQUEST";
}

export interface InitialDataResponseMessage extends BasePopoutMessage {
  type: "INITIAL_DATA_RESPONSE";
  data: any;
}

export interface DataUpdateMessage extends BasePopoutMessage {
  type: "DATA_UPDATE";
  dataType: string;
  data: any;
}

export interface HeartbeatMessage extends BasePopoutMessage {
  type: "HEARTBEAT";
}

export interface HeartbeatResponseMessage extends BasePopoutMessage {
  type: "HEARTBEAT_RESPONSE";
}

export interface ErrorMessage extends BasePopoutMessage {
  type: "ERROR";
  error: string;
  originalMessageId?: string;
}

export interface WindowClosingMessage extends BasePopoutMessage {
  type: "WINDOW_CLOSING";
}

export interface AcknowledgmentMessage extends BasePopoutMessage {
  type: "ACK";
  isAck: true;
  ackId: string;
}

export type PopoutMessage =
  | InitialDataRequestMessage
  | InitialDataResponseMessage
  | DataUpdateMessage
  | HeartbeatMessage
  | HeartbeatResponseMessage
  | ErrorMessage
  | WindowClosingMessage
  | AcknowledgmentMessage;

// Message queue item
interface QueuedMessage {
  message: PopoutMessage;
  targetWindow: Window;
  targetOrigin: string;
  retryCount: number;
  maxRetries: number;
  timestamp: number;
  resolve?: (value: any) => void;
  reject?: (error: Error) => void;
}

// Pending acknowledgment tracking
interface PendingAcknowledgment {
  messageId: string;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  timeoutId: NodeJS.Timeout;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

// Message handler configuration
interface MessageHandlerConfig {
  maxRetries: number;
  retryDelay: number;
  ackTimeout: number;
  queueProcessInterval: number;
  maxQueueSize: number;
}

// Message listener callback
type MessageListener = (
  message: PopoutMessage,
  origin: string
) => void | Promise<void>;

/**
 * Robust message passing system for popout windows
 * Provides type-safe messaging, reliable delivery, and acknowledgment system
 */
export class PopoutMessageHandler {
  private static instance: PopoutMessageHandler;

  // Message queue for reliable delivery
  private messageQueue: QueuedMessage[] = [];
  private pendingAcks: Map<string, PendingAcknowledgment> = new Map();
  private messageListeners: Map<string, MessageListener[]> = new Map();

  // Processing intervals
  private queueProcessor: NodeJS.Timeout | null = null;

  // Configuration
  private config: MessageHandlerConfig = {
    maxRetries: 3,
    retryDelay: 1000, // 1 second
    ackTimeout: 10000, // 10 seconds
    queueProcessInterval: 100, // 100ms
    maxQueueSize: 1000,
  };

  private constructor(config?: Partial<MessageHandlerConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.initializeMessageHandler();
    this.startQueueProcessor();
  }

  public static getInstance(
    config?: Partial<MessageHandlerConfig>
  ): PopoutMessageHandler {
    if (!PopoutMessageHandler.instance) {
      PopoutMessageHandler.instance = new PopoutMessageHandler(config);
    }
    return PopoutMessageHandler.instance;
  }

  /**
   * Send a message with optional acknowledgment requirement
   */
  public async sendMessage(
    targetWindow: Window,
    targetOrigin: string,
    message: Omit<PopoutMessage, "id" | "timestamp">,
    requiresAck: boolean = false
  ): Promise<any> {
    const messageId = this.generateMessageId();
    const fullMessage: PopoutMessage = {
      ...message,
      id: messageId,
      timestamp: Date.now(),
      requiresAck,
    } as PopoutMessage;

    logger.debug("[PopoutMessageHandler] Sending message", {
      type: message.type,
      messageId,
      requiresAck,
      targetOrigin,
    });

    if (requiresAck) {
      return this.sendMessageWithAck(targetWindow, targetOrigin, fullMessage);
    } else {
      return this.queueMessage(targetWindow, targetOrigin, fullMessage);
    }
  }

  /**
   * Send a message and wait for acknowledgment
   */
  private async sendMessageWithAck(
    targetWindow: Window,
    targetOrigin: string,
    message: PopoutMessage
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      // Set up acknowledgment tracking
      const timeoutId = setTimeout(() => {
        const pending = this.pendingAcks.get(message.id);
        if (pending) {
          this.pendingAcks.delete(message.id);
          reject(new Error(`Message acknowledgment timeout: ${message.type}`));
        }
      }, this.config.ackTimeout);

      this.pendingAcks.set(message.id, {
        messageId: message.id,
        timestamp: Date.now(),
        retryCount: 0,
        maxRetries: this.config.maxRetries,
        timeoutId,
        resolve,
        reject,
      });

      // Queue the message for delivery
      this.queueMessage(targetWindow, targetOrigin, message).catch((error) => {
        // Clean up pending acknowledgment on queue failure
        const pending = this.pendingAcks.get(message.id);
        if (pending) {
          clearTimeout(pending.timeoutId);
          this.pendingAcks.delete(message.id);
          reject(error);
        }
      });
    });
  }

  /**
   * Queue a message for reliable delivery
   */
  private async queueMessage(
    targetWindow: Window,
    targetOrigin: string,
    message: PopoutMessage
  ): Promise<void> {
    if (this.messageQueue.length >= this.config.maxQueueSize) {
      throw new Error("Message queue is full");
    }

    const queuedMessage: QueuedMessage = {
      message,
      targetWindow,
      targetOrigin,
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      timestamp: Date.now(),
    };

    this.messageQueue.push(queuedMessage);

    logger.debug("[PopoutMessageHandler] Message queued", {
      messageId: message.id,
      type: message.type,
      queueSize: this.messageQueue.length,
    });
  }

  /**
   * Add a message listener for a specific message type
   */
  public addMessageListener(
    messageType: string,
    listener: MessageListener
  ): () => void {
    if (!this.messageListeners.has(messageType)) {
      this.messageListeners.set(messageType, []);
    }

    const listeners = this.messageListeners.get(messageType)!;
    listeners.push(listener);

    logger.debug("[PopoutMessageHandler] Added message listener", {
      messageType,
      listenerCount: listeners.length,
    });

    // Return unsubscribe function
    return () => {
      const currentListeners = this.messageListeners.get(messageType);
      if (currentListeners) {
        const index = currentListeners.indexOf(listener);
        if (index > -1) {
          currentListeners.splice(index, 1);
          logger.debug("[PopoutMessageHandler] Removed message listener", {
            messageType,
            remainingListeners: currentListeners.length,
          });
        }
      }
    };
  }

  /**
   * Remove all listeners for a message type
   */
  public removeMessageListeners(messageType: string): void {
    this.messageListeners.delete(messageType);
    logger.debug("[PopoutMessageHandler] Removed all listeners", {
      messageType,
    });
  }

  /**
   * Send acknowledgment for a received message
   */
  public sendAcknowledgment(
    targetWindow: Window,
    targetOrigin: string,
    originalMessage: PopoutMessage,
    data?: any
  ): void {
    const ackMessage: AcknowledgmentMessage = {
      id: this.generateMessageId(),
      type: "ACK",
      timestamp: Date.now(),
      widgetId: originalMessage.widgetId,
      isAck: true,
      ackId: originalMessage.id,
      data,
    } as AcknowledgmentMessage;

    // Send acknowledgment immediately (don't queue)
    this.sendMessageDirect(targetWindow, targetOrigin, ackMessage);

    logger.debug("[PopoutMessageHandler] Sent acknowledgment", {
      originalMessageId: originalMessage.id,
      originalType: originalMessage.type,
      ackId: ackMessage.id,
    });
  }

  /**
   * Get queue statistics
   */
  public getQueueStats(): {
    queueSize: number;
    pendingAcks: number;
    totalListeners: number;
  } {
    const totalListeners = Array.from(this.messageListeners.values()).reduce(
      (total, listeners) => total + listeners.length,
      0
    );

    return {
      queueSize: this.messageQueue.length,
      pendingAcks: this.pendingAcks.size,
      totalListeners,
    };
  }

  /**
   * Clear the message queue (useful for cleanup)
   */
  public clearQueue(): void {
    this.messageQueue.length = 0;
    logger.info("[PopoutMessageHandler] Message queue cleared");
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    // Stop queue processor
    if (this.queueProcessor) {
      clearInterval(this.queueProcessor);
      this.queueProcessor = null;
    }

    // Clear pending acknowledgments
    this.pendingAcks.forEach((pending) => {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Message handler cleanup"));
    });
    this.pendingAcks.clear();

    // Clear message queue
    this.clearQueue();

    // Clear listeners
    this.messageListeners.clear();

    // Remove window event listener
    if (typeof window !== "undefined") {
      window.removeEventListener("message", this.handleMessage);
    }

    logger.info("[PopoutMessageHandler] Cleanup completed");
  }

  // Private methods

  private initializeMessageHandler(): void {
    if (typeof window === "undefined") return;

    window.addEventListener("message", this.handleMessage.bind(this));

    logger.info("[PopoutMessageHandler] Message handler initialized", {
      config: this.config,
    });
  }

  private startQueueProcessor(): void {
    this.queueProcessor = setInterval(() => {
      this.processMessageQueue();
    }, this.config.queueProcessInterval);
  }

  private processMessageQueue(): void {
    if (this.messageQueue.length === 0) return;

    const now = Date.now();
    const messagesToProcess = [...this.messageQueue];
    this.messageQueue.length = 0;

    for (const queuedMessage of messagesToProcess) {
      try {
        // Check if we should retry this message
        if (queuedMessage.retryCount >= queuedMessage.maxRetries) {
          logger.warn("[PopoutMessageHandler] Message exceeded max retries", {
            messageId: queuedMessage.message.id,
            type: queuedMessage.message.type,
            retryCount: queuedMessage.retryCount,
          });

          // Reject pending acknowledgment if exists
          const pending = this.pendingAcks.get(queuedMessage.message.id);
          if (pending) {
            clearTimeout(pending.timeoutId);
            this.pendingAcks.delete(queuedMessage.message.id);
            pending.reject(
              new Error("Message delivery failed after max retries")
            );
          }
          continue;
        }

        // Check if enough time has passed for retry
        const timeSinceLastAttempt = now - queuedMessage.timestamp;
        const shouldRetry =
          queuedMessage.retryCount === 0 ||
          timeSinceLastAttempt >=
            this.config.retryDelay * Math.pow(2, queuedMessage.retryCount - 1);

        if (!shouldRetry) {
          // Re-queue for later processing
          this.messageQueue.push(queuedMessage);
          continue;
        }

        // Attempt to send the message
        const success = this.sendMessageDirect(
          queuedMessage.targetWindow,
          queuedMessage.targetOrigin,
          queuedMessage.message
        );

        if (!success) {
          // Increment retry count and re-queue
          queuedMessage.retryCount++;
          queuedMessage.timestamp = now;
          this.messageQueue.push(queuedMessage);
        }
      } catch (error) {
        logger.error("[PopoutMessageHandler] Error processing queued message", {
          messageId: queuedMessage.message.id,
          error: error instanceof Error ? error.message : error,
        });

        // Increment retry count and re-queue
        queuedMessage.retryCount++;
        queuedMessage.timestamp = now;

        if (queuedMessage.retryCount < queuedMessage.maxRetries) {
          this.messageQueue.push(queuedMessage);
        }
      }
    }
  }

  private sendMessageDirect(
    targetWindow: Window,
    targetOrigin: string,
    message: PopoutMessage
  ): boolean {
    try {
      // Check if target window is still valid
      if (!targetWindow || targetWindow.closed) {
        logger.warn("[PopoutMessageHandler] Target window is closed", {
          messageId: message.id,
          type: message.type,
        });
        return false;
      }

      targetWindow.postMessage(message, targetOrigin);

      logger.debug("[PopoutMessageHandler] Message sent directly", {
        messageId: message.id,
        type: message.type,
        targetOrigin,
      });

      return true;
    } catch (error) {
      logger.error("[PopoutMessageHandler] Failed to send message directly", {
        messageId: message.id,
        type: message.type,
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  private handleMessage = (event: MessageEvent): void => {
    try {
      const message = event.data as PopoutMessage;

      // Validate message structure
      if (!this.isValidPopoutMessage(message)) {
        return; // Not our message
      }

      logger.debug("[PopoutMessageHandler] Received message", {
        type: message.type,
        messageId: message.id,
        origin: event.origin,
      });

      // Handle acknowledgment messages
      if (message.type === "ACK" && message.isAck && message.ackId) {
        this.handleAcknowledgment(message as AcknowledgmentMessage);
        return;
      }

      // Send acknowledgment if required
      if (message.requiresAck && event.source && event.origin) {
        this.sendAcknowledgment(event.source as Window, event.origin, message);
      }

      // Notify listeners
      this.notifyListeners(message, event.origin);
    } catch (error) {
      logger.error("[PopoutMessageHandler] Error handling message", {
        error: error instanceof Error ? error.message : error,
        origin: event.origin,
      });
    }
  };

  private handleAcknowledgment(ackMessage: AcknowledgmentMessage): void {
    const pending = this.pendingAcks.get(ackMessage.ackId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      this.pendingAcks.delete(ackMessage.ackId);

      logger.debug("[PopoutMessageHandler] Received acknowledgment", {
        originalMessageId: ackMessage.ackId,
        ackMessageId: ackMessage.id,
      });

      // Resolve with acknowledgment data if available
      pending.resolve((ackMessage as any).data || true);
    }
  }

  private notifyListeners(message: PopoutMessage, origin: string): void {
    const listeners = this.messageListeners.get(message.type);
    if (!listeners || listeners.length === 0) {
      return;
    }

    logger.debug("[PopoutMessageHandler] Notifying listeners", {
      messageType: message.type,
      listenerCount: listeners.length,
    });

    // Notify all listeners for this message type
    listeners.forEach(async (listener) => {
      try {
        await listener(message, origin);
      } catch (error) {
        logger.error("[PopoutMessageHandler] Error in message listener", {
          messageType: message.type,
          error: error instanceof Error ? error.message : error,
        });
      }
    });
  }

  private isValidPopoutMessage(data: any): data is PopoutMessage {
    return (
      data &&
      typeof data === "object" &&
      typeof data.id === "string" &&
      typeof data.type === "string" &&
      typeof data.timestamp === "number" &&
      typeof data.widgetId === "string"
    );
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

// Export singleton instance
export const popoutMessageHandler = PopoutMessageHandler.getInstance();
