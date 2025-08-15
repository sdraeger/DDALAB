'use client';

import React, { useEffect, useRef } from 'react';
import { useAppSelector } from '@/store/hooks';
import { usePopOutWindows } from '@/hooks/usePopOutWindows';

/**
 * Component that manages pop-out windows for widgets
 * This should be rendered at the app level to manage all pop-out windows
 */
export function PopOutManager() {
  const widgets = useAppSelector(state => state.dashboard.widgets);
  const { openPopOutWindow } = usePopOutWindows();
  const processedWidgets = useRef<Set<string>>(new Set());

  // Monitor widgets that should be popped out and ensure they have windows
  useEffect(() => {
    const poppedOutWidgets = widgets.filter(widget => widget.isPopOut);
    
    for (const widget of poppedOutWidgets) {
      // Only open window if we haven't already processed this widget
      if (!processedWidgets.current.has(widget.id)) {
        console.log(`Opening pop-out window for widget: ${widget.title}`);
        openPopOutWindow(widget.id);
        processedWidgets.current.add(widget.id);
      }
    }

    // Clean up processed widgets that are no longer popped out
    const poppedOutWidgetIds = new Set(poppedOutWidgets.map(w => w.id));
    for (const processedId of processedWidgets.current) {
      if (!poppedOutWidgetIds.has(processedId)) {
        processedWidgets.current.delete(processedId);
      }
    }
  }, [widgets, openPopOutWindow]);

  // This component doesn't render anything visible
  return null;
}

export default PopOutManager;