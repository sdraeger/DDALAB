# DDALAB Simple Dashboard System

A clean, intuitive dashboard system with **modern drag-and-drop capabilities** and **pop-out widgets** for flexible data analysis workflows.

## 🌊 **Modern Drag & Drop by Default**

The dashboard provides a **fluid, responsive drag experience** similar to modern applications like Figma, Sketch, or Notion. Widgets move in **real-time** with intelligent edge alignment and push functionality for intuitive layout management.

## 🪟 **Pop-Out Widget System** ✨

**NEW**: Each widget can now be popped out into a standalone browser tab/window for focused analysis and multi-monitor workflows.

### Key Features

- **Pop-Out Button** (📤): Click to open any widget in a new browser tab
- **Swap-In Button** (📥): When popped out, click to bring the widget back to the dashboard
- **Auto Swap-In**: Closing the pop-out window automatically returns the widget to the dashboard
- **State Synchronization**: Widget data stays in sync between dashboard and pop-out windows
- **Standalone Experience**: Pop-out widgets display in a clean, focused interface optimized for single-widget viewing

### Use Cases

- **Focus Mode**: Pop out widgets for distraction-free analysis
- **Multi-Monitor**: Spread widgets across multiple screens for enhanced productivity
- **Presentation**: Display specific widgets on secondary displays during meetings
- **Parallel Analysis**: Compare multiple widgets side-by-side in separate windows

## Enhanced Features

### 🎯 **Real-Time Movement**

- **Instant Response**: Widgets move immediately as you drag them
- **Smooth Visual Feedback**: Subtle scaling and rotation during drag operations
- **No Preview System**: Direct manipulation for immediate results
- **Fluid Animations**: Smooth transitions for all interactions

### 📐 **Smart Edge Alignment**

- **Automatic Snap Detection**: Widgets automatically align to edges when dragged close
- **Multiple Alignment Points**: Left, right, top, bottom, and center alignment
- **Visual Guides**: Pulsing blue lines appear to show alignment
- **10px Tolerance**: Reasonable snap distance for easy alignment
- **Always Active**: Edge alignment works regardless of settings

### 🚀 **Push Functionality**

- **Intelligent Pushing**: Dragging into another widget pushes it out of the way
- **Smart Direction**: Pushes in the direction requiring least movement
- **Real-Time Response**: Other widgets move immediately as you drag
- **Boundary Aware**: Pushed widgets stay within container bounds
- **5px Spacing**: Automatic spacing between pushed widgets

### ⚙️ **Optional Configuration**

```tsx
<SimpleDashboardGrid
  widgets={widgets}
  onWidgetUpdate={updateWidget}
  onWidgetRemove={removeWidget}
  onWidgetPopOut={popOutWidget} // NEW: Pop-out handler
  onWidgetSwapIn={swapInWidget} // NEW: Swap-in handler
  // Modern drag-and-drop is always enabled
  // These settings are now legacy and optional:
  gridSize={10} // No longer affects alignment (legacy)
  enableSnapping={false} // Edge alignment is always active (legacy)
  enableCollisionDetection={false} // Push functionality is always active (legacy)
/>
```

## Available Widgets

### 📁 **File Browser**

- Browse and select EDF files
- Integration with file loading system

### ⚙️ **DDA Analysis Form**

- Configure and run DDA analysis
- Channel selection and parameter tuning

### 📊 **Data Visualization Chart**

- General purpose data visualization
- Responsive chart display

### 🔥 **DDA Heatmap Widget** ✨

- Displays DDA Q matrix results as interactive heatmap
- Auto-updates when new analysis completes
- Loading states and error handling

### 📈 **DDA Line Plot Widget** ✨

- Line plot visualization of DDA matrix data
- Multiple display modes (Average, Individual Row, Multiple Rows)
- Interactive mode switching

## User Experience Features

### 🎪 **Modern Interactions**

- **Real-Time Dragging**: Move widgets instantly with visual feedback
- **Edge Magnetism**: Widgets snap to align with others automatically
- **Push & Rearrange**: Dragging into widgets pushes them out of the way
- **Visual Feedback**: Subtle scaling, rotation, and shadows during interactions

### 🎨 **Beautiful Visual Design**

- **Dynamic Shadows**: Enhanced shadows during drag operations
- **Subtle Animations**: Smooth scaling and rotation effects
- **Color-Coded Guides**: Blue alignment guides with pulse animation
- **Responsive Headers**: Header highlighting during drag operations

### 📱 **Intelligent Behavior**

- **Container Aware**: Respects dashboard container boundaries
- **Overlap Prevention**: Push functionality prevents unwanted overlaps
- **Size Constraints**: Enforces minimum and maximum widget sizes
- **Smooth Recovery**: Intelligent positioning when pushed to boundaries

## Usage Examples

### Basic Setup (Recommended)

```tsx
import {
  SimpleDashboardGrid,
  SimpleDashboardToolbar,
} from "shared/components/dashboard";

export default function Dashboard() {
  const {
    widgets,
    updateWidget,
    addWidget,
    removeWidget,
    popOutWidget,
    swapInWidget,
  } = useSimpleDashboard(initialWidgets);

  return (
    <div className="h-full flex flex-col">
      <SimpleDashboardToolbar onAddWidget={addWidget} />
      <div className="flex-1">
        <SimpleDashboardGrid
          widgets={widgets}
          onWidgetUpdate={updateWidget}
          onWidgetRemove={removeWidget}
          onWidgetPopOut={popOutWidget}
          onWidgetSwapIn={swapInWidget}
          // Modern drag-and-drop works automatically!
        />
      </div>
    </div>
  );
}
```

### Advanced Behavior

**🎯 Edge Alignment**

- Drag widgets close to others to see blue alignment guides
- Widgets automatically snap to align edges and centers
- Works for left, right, top, bottom, and center alignment

**🚀 Push Functionality**

- Drag one widget into another to push it out of the way
- System calculates the best direction to minimize movement
- Multiple widgets can be pushed in a chain reaction
- All movement happens in real-time with smooth animations

**📱 Responsive Design**

- Widgets respect container boundaries
- Pushed widgets find optimal positions within bounds
- Automatic spacing prevents cramped layouts

## Technical Implementation

### Core Features

- **Real-Time Updates**: Direct widget position updates during drag
- **Edge Detection**: Mathematical distance-based alignment calculation
- **Push Algorithm**: Intelligent overlap detection and directional pushing
- **Visual Feedback**: CSS transforms and transitions for smooth animations
- **Performance Optimized**: Efficient calculations with minimal re-renders

### Modern Drag Experience

- **No Preview System**: Direct manipulation for immediate feedback
- **Smart Calculations**: Efficient overlap and alignment detection
- **Boundary Management**: Intelligent positioning within container limits
- **Visual Polish**: Professional-grade animations and effects

### Pop-Out System Implementation

- **Window Management**: Pop-out windows tracked using `Map<string, Window>`
- **Cross-Window Communication**: Uses `postMessage` API for secure communication
- **State Persistence**: Widget data stored in `localStorage` with automatic cleanup
- **Auto-Detection**: Monitors for closed pop-out windows and auto-swaps widgets back
- **Route System**: Dedicated `/widget/[id]` route for standalone widget display

### Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- CSS Grid and Flexbox support required
- Mouse event support with touch device compatibility
- CSS transforms and transitions required
- **Pop-out features require**: `window.open()`, `postMessage()`, `localStorage` APIs

## Migration Benefits

The new modern dashboard system provides a superior experience compared to traditional grid-based systems:

### Drag & Drop Benefits

- ✅ **Real-time movement** instead of preview-then-apply patterns
- ✅ **Intelligent edge alignment** without restrictive grid constraints
- ✅ **Push functionality** for intuitive layout management
- ✅ **Beautiful animations** with professional visual feedback
- ✅ **Zero configuration** - works perfectly out of the box
- ✅ **Modern UX patterns** familiar to users from other applications

### Pop-Out Benefits

- ✅ **Multi-monitor support** for enhanced productivity
- ✅ **Focus mode** for distraction-free analysis
- ✅ **Presentation mode** for sharing specific widgets
- ✅ **Seamless state sync** between dashboard and pop-out windows
- ✅ **Auto window management** with smart cleanup
- ✅ **Standalone experience** optimized for single-widget viewing

**The Simple Dashboard now provides a cutting-edge experience that combines intuitive drag-and-drop interactions with powerful multi-window capabilities for professional data analysis workflows.**
