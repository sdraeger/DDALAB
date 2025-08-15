'use client';

import React, { useEffect, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from '@/store';
import { Widget } from '@/types/dashboard';
import { createWidgetContent } from '@/lib/widgetFactory';

interface PopOutRendererProps {
  widget: Widget;
  popupWindow: Window;
  onPopIn: (widgetId: string) => void;
  onClose: (widgetId: string) => void;
}

/**
 * Component that renders widget content into a popup window using React Portal-like functionality
 */
export function PopOutRenderer({ widget, popupWindow, onPopIn, onClose }: PopOutRendererProps) {
  const rootRef = useRef<Root | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!popupWindow || popupWindow.closed) {
      return;
    }

    const doc = popupWindow.document;
    
    // Set up the popup window HTML
    doc.open();
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
              background: hsl(var(--background, 0 0% 100%));
              color: hsl(var(--foreground, 222.2 84% 4.9%));
              overflow: hidden;
            }
            
            .popup-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 8px 12px;
              border-bottom: 1px solid hsl(var(--border, 214.3 31.8% 91.4%));
              background: hsl(var(--muted, 210 40% 98%));
              position: sticky;
              top: 0;
              z-index: 50;
            }
            
            .popup-title {
              font-size: 14px;
              font-weight: 600;
              flex: 1;
              color: hsl(var(--foreground, 222.2 84% 4.9%));
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
              border: 1px solid hsl(var(--border, 214.3 31.8% 91.4%));
              background: hsl(var(--background, 0 0% 100%));
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.15s ease;
              color: hsl(var(--foreground, 222.2 84% 4.9%));
            }
            
            .popup-btn:hover {
              background: hsl(var(--accent, 210 40% 96%));
            }
            
            .popup-btn-primary {
              background: hsl(var(--primary, 221.2 83.2% 53.3%));
              color: hsl(var(--primary-foreground, 210 40% 98%));
              border-color: hsl(var(--primary, 221.2 83.2% 53.3%));
            }
            
            .popup-btn-primary:hover {
              background: hsl(var(--primary, 221.2 83.2% 53.3%) / 0.9);
            }
            
            .popup-content {
              height: calc(100vh - 42px);
              overflow: auto;
              background: hsl(var(--background, 0 0% 100%));
            }
            
            .widget-container {
              height: 100%;
              width: 100%;
            }
          </style>
        </head>
        <body>
          <div class="popup-header">
            <div class="popup-title">${widget.title}</div>
            <div class="popup-actions">
              <button class="popup-btn popup-btn-primary" id="pop-in-btn">Pop In</button>
              <button class="popup-btn" id="close-btn">×</button>
            </div>
          </div>
          <div class="popup-content">
            <div id="widget-root" class="widget-container"></div>
          </div>
        </body>
      </html>
    `);
    doc.close();

    // Set up event listeners
    const popInBtn = doc.getElementById('pop-in-btn');
    const closeBtn = doc.getElementById('close-btn');
    
    if (popInBtn) {
      popInBtn.addEventListener('click', () => {
        onPopIn(widget.id);
      });
    }
    
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        onClose(widget.id);
      });
    }

    // Handle window close
    const handleBeforeUnload = () => {
      onClose(widget.id);
    };
    
    popupWindow.addEventListener('beforeunload', handleBeforeUnload);

    // Get the widget root element and render React content
    const widgetRoot = doc.getElementById('widget-root');
    if (widgetRoot) {
      containerRef.current = widgetRoot;
      
      // Create React root and render the widget
      const root = createRoot(widgetRoot);
      rootRef.current = root;
      
      const widgetContent = (
        <Provider store={store}>
          <div style={{ height: '100%', width: '100%' }}>
            {createWidgetContent(widget.type, widget.id, true, undefined, widget.data)}
          </div>
        </Provider>
      );
      
      root.render(widgetContent);
    }

    // Copy theme styles from parent window
    copyThemeStyles(doc);

    // Focus the popup window
    popupWindow.focus();

    // Cleanup function
    return () => {
      if (rootRef.current) {
        rootRef.current.unmount();
        rootRef.current = null;
      }
      popupWindow.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [widget, popupWindow, onPopIn, onClose]);

  // This component doesn't render anything in the main window
  return null;
}

/**
 * Copy theme-related CSS variables from parent to popup window
 */
function copyThemeStyles(popupDoc: Document) {
  if (typeof window === 'undefined') return;

  const parentRoot = window.document.documentElement;
  const popupRoot = popupDoc.documentElement;
  
  // Get computed styles from parent
  const parentStyles = window.getComputedStyle(parentRoot);
  
  // CSS variables to copy for theming
  const themeVars = [
    '--background', '--foreground', '--card', '--card-foreground',
    '--popover', '--popover-foreground', '--primary', '--primary-foreground',
    '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
    '--accent', '--accent-foreground', '--destructive', '--destructive-foreground',
    '--border', '--input', '--ring', '--radius'
  ];
  
  // Copy each CSS variable
  themeVars.forEach(varName => {
    const value = parentStyles.getPropertyValue(varName);
    if (value.trim()) {
      popupRoot.style.setProperty(varName, value);
    }
  });
  
  // Also copy the data-theme attribute if it exists
  const theme = parentRoot.getAttribute('data-theme');
  if (theme) {
    popupRoot.setAttribute('data-theme', theme);
  }
  
  // Copy class list for theme classes
  const themeClasses = ['light', 'dark', 'system'];
  themeClasses.forEach(themeClass => {
    if (parentRoot.classList.contains(themeClass)) {
      popupRoot.classList.add(themeClass);
    }
  });
}