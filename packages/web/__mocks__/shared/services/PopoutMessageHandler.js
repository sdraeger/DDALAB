// Mock PopoutMessageHandler for testing
export class PopoutMessageHandler {
  static instance = null;
  
  constructor(config) {
    this.config = {
      maxRetries: 3,
      retryDelay: 1000,
      ackTimeout: 10000,
      queueProcessInterval: 100,
      maxQueueSize: 1000,
      ...config,
    };
    this.messageQueue = [];
    this.pendingAcks = new Map();
    this.messageListeners = new Map();
  }

  static getInstance(config) {
    if (!PopoutMessageHandler.instance) {
      PopoutMessageHandler.instance = new PopoutMessageHandler(config);
    }
    return PopoutMessageHandler.instance;
  }

  async sendMessage(targetWindow, targetOrigin, message, requiresAck = false) {
    return Promise.resolve();
  }

  addMessageListener(messageType, listener) {
    if (!this.messageListeners.has(messageType)) {
      this.messageListeners.set(messageType, []);
    }
    this.messageListeners.get(messageType).push(listener);
    
    return () => {
      const listeners = this.messageListeners.get(messageType);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }

  removeMessageListeners(messageType) {
    this.messageListeners.delete(messageType);
  }

  sendAcknowledgment(targetWindow, targetOrigin, originalMessage, data) {
    // Mock implementation
  }

  getQueueStats() {
    const totalListeners = Array.from(this.messageListeners.values())
      .reduce((total, listeners) => total + listeners.length, 0);

    return {
      queueSize: this.messageQueue.length,
      pendingAcks: this.pendingAcks.size,
      totalListeners,
    };
  }

  clearQueue() {
    this.messageQueue.length = 0;
  }

  cleanup() {
    this.pendingAcks.clear();
    this.messageQueue.length = 0;
    this.messageListeners.clear();
  }
}

export const popoutMessageHandler = PopoutMessageHandler.getInstance();