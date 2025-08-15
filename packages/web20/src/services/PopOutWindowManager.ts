/**
 * Service for managing pop-out widget windows
 */

import { Widget } from '@/types/dashboard';
import { createWidgetContent } from '@/lib/widgetFactory';

export class PopOutWindowManager {
  private static instance: PopOutWindowManager;
  private openWindows: Map<string, Window> = new Map();

  private constructor() {
    // Handle browser events that could close windows
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.closeAllWindows();
      });
    }
  }

  static getInstance(): PopOutWindowManager {
    if (!PopOutWindowManager.instance) {
      PopOutWindowManager.instance = new PopOutWindowManager();
    }
    return PopOutWindowManager.instance;
  }

  /**
   * Opens a widget in a new popup window
   */
  openWidget(
    widget: Widget,
    onPopIn: (widgetId: string) => void,
    onStateUpdate?: (widgetId: string, data: any) => void
  ): Window | null {
    if (typeof window === 'undefined') {
      console.warn('PopOutWindowManager: Cannot open window on server side');
      return null;
    }

    // Close existing window for this widget if any
    this.closeWidget(widget.id);

    // Calculate window size based on widget size
    const windowWidth = Math.max(400, widget.size.width + 40); // Add padding
    const windowHeight = Math.max(300, widget.size.height + 80); // Add title bar and padding
    
    // Center the popup on the screen
    const screenLeft = window.screenLeft || window.screenX || 0;
    const screenTop = window.screenTop || window.screenY || 0;
    const screenWidth = window.innerWidth || document.documentElement.clientWidth || screen.width;
    const screenHeight = window.innerHeight || document.documentElement.clientHeight || screen.height;
    
    const left = screenLeft + (screenWidth - windowWidth) / 2;
    const top = screenTop + (screenHeight - windowHeight) / 2;

    // Open the popup window
    const popupWindow = window.open(
      '',
      `widget-${widget.id}`,
      `width=${windowWidth},height=${windowHeight},left=${left},top=${top},` +
      'scrollbars=yes,resizable=yes,status=no,toolbar=no,menubar=no,location=no'
    );

    if (!popupWindow) {
      console.error('PopOutWindowManager: Failed to open popup window (popup blocked?)');
      return null;
    }

    // Store window reference
    this.openWindows.set(widget.id, popupWindow);

    // Set up the popup window content
    this.setupPopupWindow(popupWindow, widget, onPopIn, onStateUpdate);

    return popupWindow;
  }

  /**
   * Sets up the popup window with the widget content
   */
  private setupPopupWindow(
    popupWindow: Window,
    widget: Widget,
    onPopIn: (widgetId: string) => void,
    onStateUpdate?: (widgetId: string, data: any) => void
  ): void {
    const doc = popupWindow.document;
    
    // Set basic HTML structure
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${widget.title} - DDA Lab</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
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
            
            .header {
              display: flex;
              align-items: center;
              justify-content: between;
              padding: 12px 16px;
              border-bottom: 1px solid #e5e7eb;
              background: #f9fafb;
              position: sticky;
              top: 0;
              z-index: 10;
            }
            
            .title {
              font-size: 14px;
              font-weight: 600;
              flex: 1;
            }
            
            .actions {
              display: flex;
              gap: 8px;
            }
            
            .btn {
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
            }
            
            .btn:hover {
              background: #f3f4f6;
              border-color: #9ca3af;
            }
            
            .btn-primary {
              background: #3b82f6;
              color: white;
              border-color: #3b82f6;
            }
            
            .btn-primary:hover {
              background: #2563eb;
              border-color: #2563eb;
            }
            
            .content {
              height: calc(100vh - 50px);
              overflow: auto;
            }
            
            .widget-container {
              height: 100%;
              padding: 0;
            }
            
            /* Dark mode styles for system preference */
            @media (prefers-color-scheme: dark) {
              body {
                background: #111827;
                color: #f9fafb;
              }
              
              .header {
                background: #1f2937;
                border-color: #374151;
              }
              
              .btn {
                background: #374151;
                color: #f9fafb;
                border-color: #4b5563;
              }
              
              .btn:hover {
                background: #4b5563;
                border-color: #6b7280;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">${widget.title}</div>
            <div class="actions">
              <button class="btn btn-primary" id="pop-in-btn">Pop In</button>
              <button class="btn" id="close-btn">Close</button>
            </div>
          </div>
          <div class="content">
            <div id="widget-root" class="widget-container"></div>
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
        onPopIn(widget.id);
        this.closeWidget(widget.id);
      });
    }
    
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        popupWindow.close();
      });
    }

    // Handle window close
    popupWindow.addEventListener('beforeunload', () => {
      this.openWindows.delete(widget.id);
      onPopIn(widget.id);
    });

    // Copy styles from parent window
    this.copyStylesToPopup(popupWindow);

    // Render the widget content using React (this is simplified - in reality you'd need React DOM)
    // For now, we'll add a message indicating this is a popup version
    const widgetRoot = doc.getElementById('widget-root');
    if (widgetRoot) {
      // This is a placeholder - actual React rendering would happen here
      widgetRoot.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #6b7280;">
          <div style="font-size: 48px; margin-bottom: 16px;">📊</div>
          <h3 style="margin-bottom: 8px;">Widget: ${widget.title}</h3>
          <p style="font-size: 14px;">Pop-out widget functionality is being rendered...</p>
          <p style="font-size: 12px; margin-top: 16px;">Type: ${widget.type}</p>
        </div>
      `;
    }

    // Focus the popup window
    popupWindow.focus();
  }

  /**
   * Copy relevant CSS from the parent window to the popup
   */
  private copyStylesToPopup(popupWindow: Window): void {
    if (typeof window === 'undefined') return;

    const parentDoc = window.document;
    const popupDoc = popupWindow.document;
    
    // Copy CSS custom properties (CSS variables) for theming
    const parentStyles = window.getComputedStyle(parentDoc.documentElement);
    const popupRoot = popupDoc.documentElement;
    
    // Copy CSS variables that might be used by components
    const cssVars = [
      '--background', '--foreground', '--card', '--card-foreground',
      '--popover', '--popover-foreground', '--primary', '--primary-foreground',
      '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
      '--accent', '--accent-foreground', '--destructive', '--destructive-foreground',
      '--border', '--input', '--ring', '--radius'
    ];
    
    cssVars.forEach(varName => {
      const value = parentStyles.getPropertyValue(varName);
      if (value) {
        popupRoot.style.setProperty(varName, value);
      }
    });
  }

  /**
   * Closes a specific widget window
   */
  closeWidget(widgetId: string): void {
    const window = this.openWindows.get(widgetId);
    if (window && !window.closed) {
      window.close();
    }
    this.openWindows.delete(widgetId);
  }

  /**
   * Closes all open widget windows
   */
  closeAllWindows(): void {
    for (const [widgetId, window] of this.openWindows) {
      if (!window.closed) {
        window.close();
      }
    }
    this.openWindows.clear();
  }

  /**
   * Gets the window reference for a widget
   */
  getWindow(widgetId: string): Window | null {
    return this.openWindows.get(widgetId) || null;
  }

  /**
   * Checks if a widget has an open window
   */
  hasOpenWindow(widgetId: string): boolean {
    const window = this.openWindows.get(widgetId);
    return window ? !window.closed : false;
  }

  /**
   * Sends a message to a popup window
   */
  sendMessageToWidget(widgetId: string, message: any): void {
    const window = this.getWindow(widgetId);
    if (window && !window.closed) {
      window.postMessage(message, '*');
    }
  }

  /**
   * Gets all open window widget IDs
   */
  getOpenWidgetIds(): string[] {
    const openIds: string[] = [];
    for (const [widgetId, window] of this.openWindows) {
      if (!window.closed) {
        openIds.push(widgetId);
      } else {
        // Clean up closed windows
        this.openWindows.delete(widgetId);
      }
    }
    return openIds;
  }
}

// Export singleton instance
export const popOutWindowManager = PopOutWindowManager.getInstance();