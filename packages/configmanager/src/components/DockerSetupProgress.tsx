import React, { useState, useEffect, useRef } from 'react';
import type { ElectronAPI } from '../utils/electron';

interface DockerSetupProgressProps {
  electronAPI?: ElectronAPI;
  isVisible: boolean;
  onClose?: () => void;
}

interface LogEntry {
  timestamp: string;
  type: string;
  level: string;
  message: string;
  serviceName?: string;
}

export const DockerSetupProgress: React.FC<DockerSetupProgressProps> = ({
  electronAPI,
  isVisible,
  onClose
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentStatus, setCurrentStatus] = useState<string>('Initializing...');
  const [showDetailedLogs, setShowDetailedLogs] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    if (!electronAPI || !isVisible) return;

    const cleanupFunctions: (() => void)[] = [];

    // Listen for status updates (main progress indicator)
    if (electronAPI.onDockerStatusUpdate) {
      const statusCleanup = electronAPI.onDockerStatusUpdate((statusUpdate) => {
        if (statusUpdate.type === 'progress' || statusUpdate.type === 'info') {
          setCurrentStatus(statusUpdate.message);
        } else if (statusUpdate.type === 'error') {
          setCurrentStatus(`Error: ${statusUpdate.message}`);
        } else if (statusUpdate.type === 'success') {
          setCurrentStatus('Docker setup completed successfully!');
          // Auto-close after success (optional)
          setTimeout(() => {
            if (onClose) onClose();
          }, 3000);
        }
      });
      cleanupFunctions.push(statusCleanup);
    }

    // Listen for detailed log streaming
    if (electronAPI.onDockerLogStream) {
      const logStreamCleanup = electronAPI.onDockerLogStream((logEntry) => {
        setLogs(prevLogs => {
          const newLog: LogEntry = {
            timestamp: logEntry.timestamp,
            type: logEntry.type,
            level: logEntry.level,
            message: logEntry.message,
            serviceName: logEntry.serviceName
          };
          
          // Keep last 200 log entries
          const updated = [...prevLogs, newLog];
          return updated.slice(-200);
        });
      });
      cleanupFunctions.push(logStreamCleanup);
    }

    cleanupRef.current = cleanupFunctions;

    return () => {
      cleanupFunctions.forEach(cleanup => cleanup());
    };
  }, [electronAPI, isVisible, onClose]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logsContainerRef.current && showDetailedLogs) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, showDetailedLogs]);

  const getLogLevelColor = (level: string): string => {
    switch (level) {
      case 'error':
        return 'text-red-400';
      case 'warning':
        return 'text-yellow-400';
      case 'success':
        return 'text-green-400';
      case 'info':
      default:
        return 'text-blue-400';
    }
  };

  const getLogTypeIcon = (type: string): string => {
    switch (type) {
      case 'service':
        return '🔄';
      case 'error':
        return '❌';
      case 'log':
        return '📋';
      default:
        return '•';
    }
  };

  const formatTimestamp = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-4/5 max-w-4xl h-4/5 flex flex-col">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Docker Setup Progress
            </h2>
            {onClose && (
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                ✕
              </button>
            )}
          </div>
          
          {/* Current Status */}
          <div className="mt-4">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <span className="text-gray-700 dark:text-gray-300 font-medium">
                {currentStatus}
              </span>
            </div>
          </div>

          {/* Progress Indicator */}
          <div className="mt-4">
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div className="bg-blue-500 h-2 rounded-full animate-pulse" style={{width: '45%'}}></div>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              This may take several minutes for first-time setup...
            </p>
          </div>

          {/* Toggle detailed logs */}
          <div className="mt-4">
            <button
              onClick={() => setShowDetailedLogs(!showDetailedLogs)}
              className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
            >
              {showDetailedLogs ? 'Hide' : 'Show'} detailed logs ({logs.length})
            </button>
          </div>
        </div>

        {/* Detailed Logs Section */}
        {showDetailedLogs && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Live Docker Logs
              </h3>
            </div>
            
            <div 
              ref={logsContainerRef}
              className="flex-1 overflow-y-auto p-4 bg-black text-green-400 font-mono text-sm"
            >
              {logs.length === 0 ? (
                <div className="text-gray-500 text-center py-8">
                  Waiting for Docker operations to begin...
                </div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="mb-1 flex items-start space-x-2">
                    <span className="text-gray-500 text-xs shrink-0">
                      {formatTimestamp(log.timestamp)}
                    </span>
                    <span className="text-xs shrink-0">
                      {getLogTypeIcon(log.type)}
                    </span>
                    {log.serviceName && (
                      <span className="text-purple-400 text-xs shrink-0">
                        [{log.serviceName}]
                      </span>
                    )}
                    <span className={`${getLogLevelColor(log.level)} break-all`}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            <p>💡 <strong>First-time setup:</strong> Docker images are being downloaded. This may take 10-20 minutes depending on your internet connection.</p>
            <p>💡 <strong>Slow progress?</strong> This is normal for large images. The process will continue in the background.</p>
          </div>
        </div>
      </div>
    </div>
  );
};