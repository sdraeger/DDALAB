import React, { useState, useEffect, useRef } from "react";
import type { ElectronAPI } from "../utils/electron";

interface LogsViewerModalProps {
  electronAPI?: ElectronAPI;
  onClose: () => void;
}

interface LogEntry {
  timestamp: string;
  service: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export const LogsViewerModal: React.FC<LogsViewerModalProps> = ({
  electronAPI,
  onClose,
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [filterService, setFilterService] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const fetchInitialLogs = async () => {
      setIsLoading(true);

      if (!electronAPI) {
        setLogs([{
          timestamp: new Date().toISOString(),
          service: 'System',
          level: 'error',
          message: 'Electron API not available'
        }]);
        setIsLoading(false);
        return;
      }

      try {
        // Get current Docker logs
        const dockerLogs = await electronAPI.getDockerLogs();

        // Parse Docker logs into structured format
        const parsedLogs = parseDockerLogs(dockerLogs);
        setLogs(parsedLogs);

        // Start streaming logs
        startLogStreaming();
      } catch (error) {
        console.error('Failed to fetch initial logs:', error);
        setLogs([{
          timestamp: new Date().toISOString(),
          service: 'System',
          level: 'error',
          message: `Failed to fetch logs: ${error}`
        }]);
      } finally {
        setIsLoading(false);
      }
    };

    const startLogStreaming = async () => {
      if (!electronAPI) return;

      try {
        await electronAPI.startDockerLogStream();
        setIsStreaming(true);

        // Set up log listener
        const cleanup = electronAPI.onDockerLogs((log: { type: string; data: string }) => {
          const newLogEntry: LogEntry = {
            timestamp: new Date().toISOString(),
            service: log.type || 'Docker',
            level: 'info',
            message: log.data || ''
          };

          setLogs(prevLogs => [...prevLogs, newLogEntry].slice(-1000)); // Keep last 1000 logs
        });

        cleanupRef.current = cleanup;
      } catch (error) {
        console.error('Failed to start log streaming:', error);
        setIsStreaming(false);
      }
    };

    fetchInitialLogs();

    // Cleanup on unmount
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
      if (electronAPI) {
        electronAPI.clearDockerLogsListener();
      }
    };
  }, [electronAPI]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const parseDockerLogs = (rawLogs: string): LogEntry[] => {
    if (!rawLogs) return [];

    const lines = rawLogs.split('\n').filter(line => line.trim());
    return lines.map(line => {
      // Try to parse Docker compose log format
      const match = line.match(/^(\S+)\s*\|\s*(.+)$/);
      if (match) {
        return {
          timestamp: new Date().toISOString(),
          service: match[1],
          level: 'info' as const,
          message: match[2]
        };
      }

      // Fallback to raw line
      return {
        timestamp: new Date().toISOString(),
        service: 'Docker',
        level: 'info' as const,
        message: line
      };
    });
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const downloadLogs = () => {
    const logText = filteredLogs.map(log =>
      `[${log.timestamp}] [${log.service}] [${log.level.toUpperCase()}] ${log.message}`
    ).join('\n');

    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ddalab-logs-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredLogs = logs.filter(log => {
    const levelMatch = filterLevel === 'all' || log.level === filterLevel;
    const serviceMatch = filterService === 'all' || log.service === filterService;
    return levelMatch && serviceMatch;
  });

  const availableServices = Array.from(new Set(logs.map(log => log.service)));

  const getLevelClass = (level: string) => {
    switch (level) {
      case 'error': return 'danger';
      case 'warn': return 'warning';
      case 'info': return 'info';
      case 'debug': return 'secondary';
      default: return 'light';
    }
  };

  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'error': return '❌';
      case 'warn': return '⚠️';
      case 'info': return 'ℹ️';
      case 'debug': return '🔍';
      default: return '📝';
    }
  };

  return (
    <div className="logs-viewer-modal">
      <div className="modal-backdrop show"></div>
      <div className="modal show d-block">
        <div className="modal-dialog modal-xl">
          <div className="modal-content">
            <div className="modal-header">
              <div className="header-content">
                <h5 className="modal-title">📋 Logs Viewer</h5>
                {isStreaming && (
                  <span className="streaming-indicator">
                    <span className="status-dot"></span>
                    Live streaming
                  </span>
                )}
              </div>
              <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
            </div>

            <div className="modal-body">
              {/* Controls */}
              <div className="logs-controls">
                <div className="filter-controls">
                  <div className="filter-group">
                    <label htmlFor="level-filter">Level:</label>
                    <select
                      id="level-filter"
                      className="form-select form-select-sm"
                      value={filterLevel}
                      onChange={(e) => setFilterLevel(e.target.value)}
                    >
                      <option value="all">All Levels</option>
                      <option value="error">Error</option>
                      <option value="warn">Warning</option>
                      <option value="info">Info</option>
                      <option value="debug">Debug</option>
                    </select>
                  </div>

                  <div className="filter-group">
                    <label htmlFor="service-filter">Service:</label>
                    <select
                      id="service-filter"
                      className="form-select form-select-sm"
                      value={filterService}
                      onChange={(e) => setFilterService(e.target.value)}
                    >
                      <option value="all">All Services</option>
                      {availableServices.map(service => (
                        <option key={service} value={service}>{service}</option>
                      ))}
                    </select>
                  </div>

                  <div className="filter-group">
                    <label className="form-check-label">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={autoScroll}
                        onChange={(e) => setAutoScroll(e.target.checked)}
                      />
                      Auto-scroll
                    </label>
                  </div>
                </div>

                <div className="action-controls">
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    onClick={clearLogs}
                    title="Clear all logs"
                  >
                    🗑️ Clear
                  </button>
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={downloadLogs}
                    title="Download logs as text file"
                  >
                    💾 Download
                  </button>
                  <div className="logs-count">
                    {filteredLogs.length} / {logs.length} logs
                  </div>
                </div>
              </div>

              {/* Logs Container */}
              <div className="logs-container" ref={logsContainerRef}>
                {isLoading ? (
                  <div className="text-center p-4">
                    <div className="spinner-border" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                    <p className="mt-2">Loading logs...</p>
                  </div>
                ) : filteredLogs.length === 0 ? (
                  <div className="no-logs-message">
                    <p>No logs available matching current filters.</p>
                    {logs.length > 0 && (
                      <p>Try adjusting the filter settings above.</p>
                    )}
                  </div>
                ) : (
                  <div className="logs-list">
                    {filteredLogs.map((log, index) => (
                      <div key={index} className={`log-entry level-${log.level}`}>
                        <div className="log-meta">
                          <span className="log-timestamp">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                          <span className={`log-level badge bg-${getLevelClass(log.level)}`}>
                            {getLevelIcon(log.level)} {log.level.toUpperCase()}
                          </span>
                          <span className="log-service">
                            {log.service}
                          </span>
                        </div>
                        <div className="log-message">
                          {log.message}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .logs-viewer-modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 2000;
        }

        .modal-backdrop {
          background-color: rgba(0, 0, 0, 0.5);
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 1999;
        }

        .modal {
          z-index: 2001;
        }

        .modal-content {
          border-radius: 16px;
          border: none;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
          height: 90vh;
          display: flex;
          flex-direction: column;
        }

        .modal-header {
          padding: 20px 24px;
          border-bottom: 1px solid #e9ecef;
          background: #fff;
          border-radius: 8px 8px 0 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }

        .header-content {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .modal-title {
          font-size: 18px;
          font-weight: 600;
          margin: 0;
          color: #495057;
        }

        .streaming-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          background: #e8f5e8;
          color: #28a745;
          padding: 4px 8px;
          border-radius: 12px;
          font-weight: 600;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #28a745;
          animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        .btn-close {
          background: transparent;
          border: none;
          font-size: 20px;
          font-weight: 700;
          line-height: 1;
          color: #6c757d;
          opacity: 0.75;
          padding: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .btn-close:hover {
          color: #000;
          opacity: 1;
        }

        .btn-close:focus {
          outline: none;
          box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
        }

        .modal-body {
          flex: 1;
          padding: 0;
          background: #f8f9fa;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .logs-controls {
          padding: 20px 24px;
          background: white;
          border-bottom: 1px solid #e9ecef;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
          flex-shrink: 0;
        }

        .filter-controls {
          display: flex;
          gap: 20px;
          align-items: center;
        }

        .filter-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .filter-group label {
          font-size: 14px;
          font-weight: 500;
          color: #495057;
          margin: 0;
        }

        .form-select-sm {
          min-width: 120px;
        }

        .action-controls {
          display: flex;
          gap: 12px;
          align-items: center;
        }

        .logs-count {
          font-size: 12px;
          color: #6c757d;
          font-weight: 500;
        }

        .logs-container {
          flex: 1;
          overflow-y: auto;
          background: #ffffff;
          margin: 0 24px 24px;
          border-radius: 12px;
          border: 1px solid #e1e5e9;
        }

        .no-logs-message {
          padding: 40px;
          text-align: center;
          color: #6c757d;
        }

        .logs-list {
          padding: 0;
        }

        .log-entry {
          padding: 12px 20px;
          border-bottom: 1px solid #f1f3f4;
          transition: background-color 0.2s ease;
        }

        .log-entry:last-child {
          border-bottom: none;
        }

        .log-entry:hover {
          background-color: #f8f9fa;
        }

        .log-entry.level-error {
          border-left: 3px solid #dc3545;
        }

        .log-entry.level-warn {
          border-left: 3px solid #ffc107;
        }

        .log-entry.level-info {
          border-left: 3px solid #17a2b8;
        }

        .log-entry.level-debug {
          border-left: 3px solid #6c757d;
        }

        .log-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 6px;
        }

        .log-timestamp {
          font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
          font-size: 11px;
          color: #6c757d;
          min-width: 80px;
        }

        .log-level {
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .log-service {
          font-size: 11px;
          font-weight: 600;
          color: #495057;
          background: #e9ecef;
          padding: 2px 8px;
          border-radius: 10px;
        }

        .log-message {
          font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
          font-size: 13px;
          color: #2c3e50;
          line-height: 1.4;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .modal-footer {
          padding: 16px 24px;
          border-top: 1px solid #e9ecef;
          background: white;
          border-radius: 0 0 16px 16px;
          flex-shrink: 0;
        }

        .bg-danger {
          background-color: #f8d7da !important;
          color: #721c24 !important;
        }

        .bg-warning {
          background-color: #fff3cd !important;
          color: #856404 !important;
        }

        .bg-info {
          background-color: #d1ecf1 !important;
          color: #0c5460 !important;
        }

        .bg-secondary {
          background-color: #e9ecef !important;
          color: #495057 !important;
        }

        .bg-light {
          background-color: #f8f9fa !important;
          color: #6c757d !important;
        }
      `}</style>
    </div>
  );
};
