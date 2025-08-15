import React, { useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { popInWidget } from '@/store/slices/dashboardSlice';
import { Widget } from '@/types/dashboard';
import { createWidgetContent } from '@/lib/widgetFactory';
import { store } from '@/store';

interface PopOutWindowInfo {
  widget: Widget;
  window: Window;
  root: any; // React root for rendering
  checkInterval?: NodeJS.Timeout; // Interval for checking if window is closed
}

// Error boundary component for pop-out windows
class PopOutErrorBoundary extends React.Component {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('Pop-out window error:', error, errorInfo);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack
    });
  }

  render() {
    if ((this.state as any).hasError) {
      return React.createElement('div', {
        className: 'flex items-center justify-center h-full p-4 text-center',
        style: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', textAlign: 'center' }
      }, React.createElement('div', null, 
        React.createElement('h3', { className: 'text-lg font-semibold mb-2' }, 'Widget Error'),
        React.createElement('p', { className: 'text-sm text-gray-600 mb-4' }, `This widget cannot be rendered in a pop-out window due to compatibility issues.`),
        React.createElement('p', { className: 'text-xs text-gray-500' }, 'Please use the widget in the main dashboard instead.')
      ));
    }

    return (this.props as any).children;
  }
}


/**
 * Renders widget content in a popup window using React
 */
function renderWidgetInPopup(container: HTMLElement, widget: Widget): any {
  const root = createRoot(container);
  
  // Provide file selection callback to file-browser widgets
  const handleFileSelect = (filePath: string) => {
    console.log('[PopOut] File selected:', filePath);
  };

  console.log(`Pop-out rendering for ${widget.type}`);

  // Create the widget content wrapped in Redux provider and error boundary
  const WidgetWrapper = () => React.createElement(
    Provider, 
    { store },
    React.createElement(
      PopOutErrorBoundary,
      null,
      React.createElement(
        'div',
        { className: 'w-full h-full' },
        createWidgetContent(widget.type, widget.id, true, handleFileSelect, widget.data)
      )
    )
  );

  root.render(React.createElement(WidgetWrapper));
  return root;
}

/**
 * Hook for managing pop-out widget windows
 */
export function usePopOutWindows() {
  const dispatch = useAppDispatch();
  const widgets = useAppSelector(state => state.dashboard.widgets);
  const activeWindows = useRef<Map<string, PopOutWindowInfo>>(new Map());

  /**
   * Opens a widget in a popup window
   */
  const openPopOutWindow = useCallback((widgetId: string) => {
    const widget = widgets.find(w => w.id === widgetId);
    if (!widget || !widget.isPopOut) {
      return null;
    }

    // Check if we already have a window for this widget
    const existingWindow = activeWindows.current.get(widgetId);
    if (existingWindow && !existingWindow.window.closed) {
      existingWindow.window.focus();
      return existingWindow.window;
    }

    if (typeof window === 'undefined') {
      console.warn('Cannot open popup window on server side');
      return null;
    }

    // Calculate window size
    const windowWidth = Math.max(400, widget.size.width + 40);
    const windowHeight = Math.max(300, widget.size.height + 100);
    
    // Center the popup
    const screenLeft = window.screenLeft || window.screenX || 0;
    const screenTop = window.screenTop || window.screenY || 0;
    const screenWidth = window.innerWidth || document.documentElement.clientWidth || screen.width;
    const screenHeight = window.innerHeight || document.documentElement.clientHeight || screen.height;
    
    const left = screenLeft + (screenWidth - windowWidth) / 2;
    const top = screenTop + (screenHeight - windowHeight) / 2;

    // Open popup window
    const popupWindow = window.open(
      '',
      `widget-${widget.id}`,
      `width=${windowWidth},height=${windowHeight},left=${left},top=${top},` +
      'scrollbars=yes,resizable=yes,status=no,toolbar=no,menubar=no,location=no'
    );

    if (!popupWindow) {
      console.error('Failed to open popup window - popup might be blocked');
      return null;
    }

    // Window reference is now managed locally in the hook instead of Redux

    // Set up the popup window content and get the React root
    const { reactRoot, renderPromise } = setupPopupWindow(popupWindow, widget);

    // Monitor window state with polling
    const windowCheckInterval = setInterval(() => {
      if (popupWindow.closed) {
        clearInterval(windowCheckInterval);
        popInWidget_Handler(widget.id);
      }
    }, 1000);

    // Store in local ref for cleanup, and update with actual root when ready
    const windowInfo = {
      widget,
      window: popupWindow,
      root: reactRoot,
      checkInterval: windowCheckInterval
    };
    
    activeWindows.current.set(widgetId, windowInfo);
    
    // Update the root when rendering is complete
    renderPromise.then((root) => {
      const currentWindowInfo = activeWindows.current.get(widgetId);
      if (currentWindowInfo) {
        currentWindowInfo.root = root;
      }
    });

    return popupWindow;
  }, [widgets, dispatch]);

  /**
   * Closes a pop-out window and pops the widget back in
   */
  const closePopOutWindow = useCallback((widgetId: string) => {
    const windowInfo = activeWindows.current.get(widgetId);
    if (windowInfo) {
      if (!windowInfo.window.closed) {
        windowInfo.window.close();
      }
      if (windowInfo.checkInterval) {
        clearInterval(windowInfo.checkInterval);
      }
      if (windowInfo.root) {
        windowInfo.root.unmount();
      }
    }
    
    activeWindows.current.delete(widgetId);
    dispatch(popInWidget(widgetId));
  }, [dispatch]);

  /**
   * Pops a widget back into the main dashboard
   */
  const popInWidget_Handler = useCallback((widgetId: string) => {
    closePopOutWindow(widgetId);
  }, [closePopOutWindow]);

  /**
   * Setup the popup window with widget content
   */
  const setupPopupWindow = useCallback((popupWindow: Window, widget: Widget) => {
    const doc = popupWindow.document;
    
    // Create basic HTML structure
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${widget.title} - DDA Lab</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <script src="https://cdn.tailwindcss.com"></script>
          <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
          <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
          <script src="https://unpkg.com/uplot@1.6.24/dist/uPlot.iife.min.js"></script>
          <link rel="stylesheet" href="https://unpkg.com/uplot@1.6.24/dist/uPlot.min.css">
          <script>
            // Set up module environment for popup window
            const parentWindow = window.opener || window.parent;
            
            console.log('Setting up popup window environment...');
            
            // Wait for CDN libraries to load, then set up globals
            let setupAttempts = 0;
            const setupLibraries = () => {
              if (window.React && window.ReactDOM && window.uPlot) {
                console.log('All CDN libraries loaded successfully');
                console.log('React:', !!window.React, 'ReactDOM:', !!window.ReactDOM, 'uPlot:', !!window.uPlot);
                
                // Set up module resolution for React and uPlot
                if (!window.require) {
                  window.require = function(moduleName) {
                    switch (moduleName) {
                      case 'react': return window.React;
                      case 'react-dom': return window.ReactDOM;
                      case 'react-dom/client': return { createRoot: window.ReactDOM.createRoot };
                      case 'uplot': return window.uPlot;
                      default: 
                        if (parentWindow && parentWindow.require) {
                          return parentWindow.require(moduleName);
                        }
                        throw new Error('Module not found: ' + moduleName);
                    }
                  };
                }
                
                console.log('Module resolution setup complete');
              } else if (setupAttempts < 20) {
                setupAttempts++;
                console.log('Waiting for libraries... attempt', setupAttempts);
                setTimeout(setupLibraries, 200);
              } else {
                console.warn('Failed to load all required libraries after 20 attempts');
              }
            };
            setTimeout(setupLibraries, 100);
            
            // Set up Node.js-like environment
            if (!window.global) {
              window.global = window;
            }
            
            if (!window.process) {
              window.process = { env: {} };
            }
            
            console.log('Popup window environment setup complete');
          </script>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              background: #ffffff;
              color: #1f2937;
              overflow: hidden;
            }
            
            .popup-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 8px 12px;
              border-bottom: 1px solid #e5e7eb;
              background: #f9fafb;
              position: sticky;
              top: 0;
              z-index: 50;
              height: 42px;
            }
            
            .popup-title {
              font-size: 14px;
              font-weight: 600;
              flex: 1;
              color: #1f2937;
            }
            
            .popup-actions {
              display: flex;
              gap: 4px;
            }
            
            .popup-btn {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              padding: 4px 8px;
              border: 1px solid #d1d5db;
              background: #ffffff;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.15s ease;
              color: #374151;
              min-width: 24px;
              height: 24px;
            }
            
            .popup-btn:hover {
              background: #f3f4f6;
              border-color: #9ca3af;
            }
            
            .popup-btn-primary {
              background: #3b82f6;
              color: white;
              border-color: #3b82f6;
            }
            
            .popup-btn-primary:hover {
              background: #2563eb;
              border-color: #2563eb;
            }
            
            .popup-content {
              height: calc(100vh - 42px);
              overflow: auto;
              background: #ffffff;
            }
            
            .widget-container {
              height: 100%;
              width: 100%;
            }
            
            .loading-message {
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100%;
              flex-direction: column;
              color: #6b7280;
              font-size: 14px;
            }
            
            .loading-icon {
              font-size: 48px;
              margin-bottom: 16px;
            }
            
            /* Dark mode styles */
            @media (prefers-color-scheme: dark) {
              body {
                background: #111827;
                color: #f9fafb;
              }
              
              .popup-header {
                background: #1f2937;
                border-color: #374151;
              }
              
              .popup-title {
                color: #f9fafb;
              }
              
              .popup-btn {
                background: #374151;
                color: #f9fafb;
                border-color: #4b5563;
              }
              
              .popup-btn:hover {
                background: #4b5563;
                border-color: #6b7280;
              }
              
              .popup-content {
                background: #111827;
              }
              
              .loading-message {
                color: #9ca3af;
              }
            }
          </style>
        </head>
        <body>
          <div class="popup-header">
            <div class="popup-title">${widget.title}</div>
            <div class="popup-actions">
              <button class="popup-btn popup-btn-primary" id="pop-in-btn" title="Pop back into dashboard">Pop In</button>
              <button class="popup-btn" id="close-btn" title="Close window">×</button>
            </div>
          </div>
          <div class="popup-content">
            <div id="widget-root" class="widget-container">
              <div class="loading-message">
                <div class="loading-icon">📊</div>
                <div>Loading ${widget.title}...</div>
                <div style="font-size: 12px; margin-top: 8px; opacity: 0.7;">Type: ${widget.type}</div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `);
    doc.close();

    // Add event listeners
    const popInBtn = doc.getElementById('pop-in-btn');
    const closeBtn = doc.getElementById('close-btn');
    
    if (popInBtn) {
      popInBtn.addEventListener('click', () => {
        popInWidget_Handler(widget.id);
      });
    }
    
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        popupWindow.close();
      });
    }

    // Window close monitoring is handled by the parent function

    // Focus the popup
    popupWindow.focus();

    // Set up widget content rendering after a delay to ensure DOM and scripts are ready
    let reactRoot = null;
    const renderPromise = new Promise((resolve) => {
      // Wait for external scripts to load
      setTimeout(() => {
        const widgetRoot = doc.getElementById('widget-root');
        if (widgetRoot) {
          // Clear the loading content first
          widgetRoot.innerHTML = '';
          
          // Copy parent window's stylesheets to popup
          const parentStylesheets = Array.from(window.document.styleSheets);
          parentStylesheets.forEach((stylesheet, index) => {
            try {
              if (stylesheet.href) {
                // External stylesheet - create link element
                const link = doc.createElement('link');
                link.rel = 'stylesheet';
                link.href = stylesheet.href;
                doc.head.appendChild(link);
              } else if (stylesheet.ownerNode && stylesheet.ownerNode.textContent) {
                // Inline stylesheet - create style element
                const style = doc.createElement('style');
                style.textContent = stylesheet.ownerNode.textContent;
                doc.head.appendChild(style);
              }
            } catch (e) {
              console.warn('Could not copy stylesheet:', e);
            }
          });
          
          // Check library availability
          console.log('Libraries in popup window:');
          console.log('React:', !!popupWindow.React);
          console.log('ReactDOM:', !!popupWindow.ReactDOM);
          console.log('uPlot:', !!popupWindow.uPlot);
          
          // Debug uPlot specifically
          if (popupWindow.uPlot) {
            console.log('uPlot type:', typeof popupWindow.uPlot);
            console.log('uPlot constructor:', popupWindow.uPlot.toString().substring(0, 100));
            try {
              // Test if uPlot constructor works as expected
              const testDiv = doc.createElement('div');
              testDiv.style.width = '100px';
              testDiv.style.height = '100px';
              doc.body.appendChild(testDiv);
              
              const testOpts = {
                width: 100,
                height: 100,
                series: [{ label: 'x' }, { label: 'y' }],
                scales: { x: { time: false }, y: { auto: true } },
                axes: [{ label: 'x' }, { label: 'y' }]
              };
              const testData = [[0, 1, 2], [0, 1, 4]];
              
              const testPlot = new popupWindow.uPlot(testOpts, testData, testDiv);
              console.log('uPlot test successful, destroying test instance');
              testPlot.destroy();
              doc.body.removeChild(testDiv);
            } catch (e) {
              console.error('uPlot test failed:', e);
            }
          }
          
          // Render the actual React widget content
          reactRoot = renderWidgetInPopup(widgetRoot, widget);
          resolve(reactRoot);
        }
      }, 1000); // Further increased delay for script loading
    });
    
    return { reactRoot, renderPromise };
  }, [popInWidget_Handler]);

  /**
   * Clean up all windows on unmount
   */
  useEffect(() => {
    return () => {
      for (const [widgetId, windowInfo] of activeWindows.current) {
        if (!windowInfo.window.closed) {
          windowInfo.window.close();
        }
        if (windowInfo.checkInterval) {
          clearInterval(windowInfo.checkInterval);
        }
        if (windowInfo.root) {
          windowInfo.root.unmount();
        }
      }
      activeWindows.current.clear();
    };
  }, []);

  /**
   * Monitor widgets and close windows for widgets that are no longer popped out
   */
  useEffect(() => {
    const poppedOutWidgets = widgets.filter(w => w.isPopOut);
    const openWindowIds = Array.from(activeWindows.current.keys());
    
    // Close windows for widgets that are no longer popped out
    for (const windowId of openWindowIds) {
      const stillPoppedOut = poppedOutWidgets.some(w => w.id === windowId);
      if (!stillPoppedOut) {
        const windowInfo = activeWindows.current.get(windowId);
        if (windowInfo) {
          if (!windowInfo.window.closed) {
            windowInfo.window.close();
          }
          if (windowInfo.checkInterval) {
            clearInterval(windowInfo.checkInterval);
          }
          if (windowInfo.root) {
            windowInfo.root.unmount();
          }
        }
        activeWindows.current.delete(windowId);
      }
    }
  }, [widgets]);

  return {
    openPopOutWindow,
    closePopOutWindow,
    popInWidget: popInWidget_Handler,
  };
}