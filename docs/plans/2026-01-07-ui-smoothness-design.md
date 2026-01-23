# UI Smoothness & Polish Design

**Date:** 2026-01-07
**Status:** Approved
**Goal:** Make the app feel smooth and professional like Instagram/Apple

## Problem

The app feels "choppy and loose" due to:
- Instant state changes without transitions
- Abrupt loading state changes
- Inconsistent animation patterns across components
- Missing micro-interactions and feedback

## Design Principles

Based on Apple's Human Interface Guidelines:

| Principle | Implementation |
|-----------|----------------|
| **Responsive** | Every interaction has immediate visual feedback (< 100ms) |
| **Natural** | Easing curves mimic real physics |
| **Consistent** | Same durations and curves for similar actions |
| **Subtle** | Motion supports content, never distracts |

## Motion Tokens

### Timing Scale

```
instant:  0ms      → Immediate state changes (checkbox, toggle)
fast:     150ms    → Micro-interactions (hover, focus, button press)
normal:   200ms    → Standard transitions (panel open, tab switch)
slow:     300ms    → Larger movements (modal, sidebar, page transition)
slower:   500ms    → Emphasis animations (onboarding, celebrations)
```

### Easing Curves

```css
--ease-out:     cubic-bezier(0.16, 1, 0.3, 1)    /* Things entering */
--ease-in:      cubic-bezier(0.7, 0, 0.84, 0)    /* Things leaving */
--ease-in-out:  cubic-bezier(0.87, 0, 0.13, 1)   /* Things moving */
--spring:       cubic-bezier(0.34, 1.56, 0.64, 1) /* Playful bounce */
```

## Implementation Phases

### Phase 1: Foundation (Global Impact)

Add to `tailwind.config.ts`:
```js
extend: {
  transitionTimingFunction: {
    'out': 'cubic-bezier(0.16, 1, 0.3, 1)',
    'in': 'cubic-bezier(0.7, 0, 0.84, 0)',
    'in-out': 'cubic-bezier(0.87, 0, 0.13, 1)',
    'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  transitionDuration: {
    'fast': '150ms',
    'normal': '200ms',
    'slow': '300ms',
  },
  keyframes: {
    'fade-in': {
      '0%': { opacity: '0' },
      '100%': { opacity: '1' },
    },
    'fade-out': {
      '0%': { opacity: '1' },
      '100%': { opacity: '0' },
    },
    'slide-up': {
      '0%': { opacity: '0', transform: 'translateY(8px)' },
      '100%': { opacity: '1', transform: 'translateY(0)' },
    },
    'slide-down': {
      '0%': { opacity: '0', transform: 'translateY(-8px)' },
      '100%': { opacity: '1', transform: 'translateY(0)' },
    },
    'scale-in': {
      '0%': { opacity: '0', transform: 'scale(0.95)' },
      '100%': { opacity: '1', transform: 'scale(1)' },
    },
    'scale-out': {
      '0%': { opacity: '1', transform: 'scale(1)' },
      '100%': { opacity: '0', transform: 'scale(0.95)' },
    },
  },
  animation: {
    'fade-in': 'fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
    'fade-out': 'fade-out 150ms cubic-bezier(0.7, 0, 0.84, 0)',
    'slide-up': 'slide-up 200ms cubic-bezier(0.16, 1, 0.3, 1)',
    'slide-down': 'slide-down 200ms cubic-bezier(0.16, 1, 0.3, 1)',
    'scale-in': 'scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
    'scale-out': 'scale-out 150ms cubic-bezier(0.7, 0, 0.84, 0)',
  },
}
```

Add to `globals.css`:
```css
/* Global transition defaults for all interactive elements */
button:not([data-no-transition]),
a:not([data-no-transition]),
[role="button"]:not([data-no-transition]),
[role="tab"]:not([data-no-transition]),
[role="menuitem"]:not([data-no-transition]),
input:not([data-no-transition]),
select:not([data-no-transition]),
textarea:not([data-no-transition]) {
  transition:
    background-color 150ms cubic-bezier(0.16, 1, 0.3, 1),
    border-color 150ms cubic-bezier(0.16, 1, 0.3, 1),
    color 150ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 150ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 150ms cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 150ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* Button press feedback */
button:active:not(:disabled),
[role="button"]:active:not([aria-disabled="true"]) {
  transform: scale(0.98);
}

/* Smooth scrolling for containers */
.smooth-scroll {
  scroll-behavior: smooth;
}

/* GPU acceleration hint for animated elements */
.will-animate {
  will-change: transform, opacity;
}
```

### Phase 2: High-Traffic Components

#### Sidebar Collapse
```tsx
// Sidebar.tsx
<aside
  className={cn(
    "transition-[width] duration-slow ease-out",
    isCollapsed ? "w-16" : "w-64"
  )}
>
  {/* Content with opacity transition */}
  <div className={cn(
    "transition-opacity duration-normal ease-out",
    isCollapsed ? "opacity-0" : "opacity-100"
  )}>
    {!isCollapsed && children}
  </div>
</aside>
```

#### File Tab Bar
- Active tab indicator slides with `transition-[left,width]`
- New tabs fade-in with `animate-fade-in`
- Closed tabs fade-out before removal

#### Loading Overlay
```tsx
// Proper fade transition
<div className={cn(
  "transition-opacity duration-normal ease-out",
  isLoading ? "opacity-100" : "opacity-0 pointer-events-none"
)}>
  {/* Loading content */}
</div>
```

### Phase 3: Content Transitions

#### Plot Loading (Crossfade Pattern)
```tsx
// Container holds both skeleton and chart
<div className="relative">
  {/* Skeleton fades out */}
  <div className={cn(
    "absolute inset-0 transition-opacity duration-normal ease-out",
    isLoaded ? "opacity-0 pointer-events-none" : "opacity-100"
  )}>
    <PlotSkeleton />
  </div>

  {/* Chart fades in */}
  <div className={cn(
    "transition-opacity duration-normal ease-out",
    isLoaded ? "opacity-100" : "opacity-0"
  )}>
    <Chart />
  </div>
</div>
```

#### Dialog/Modal (Radix Config)
```tsx
<Dialog.Content className="data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out">
```

#### Dropdown Menus
```tsx
<DropdownMenu.Content className="data-[state=open]:animate-slide-down data-[state=closed]:animate-fade-out">
```

### Phase 4: Micro-Interactions

#### Checkbox Toggle
```css
input[type="checkbox"]:active {
  transform: scale(0.9);
}
input[type="checkbox"]:checked {
  animation: scale-in 150ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

#### Hover States
All interactive elements get subtle background/border color transitions (handled by Phase 1 globals).

#### Focus Rings
```css
/* Smooth focus ring appearance */
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--ring);
  transition: box-shadow 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

## Files to Modify

| Priority | File | Changes |
|----------|------|---------|
| 1 | `tailwind.config.ts` | Add easing, duration, animation tokens |
| 1 | `src/app/globals.css` | Global transition defaults |
| 1 | `src/styles/focus.css` | Smooth focus rings |
| 2 | `components/layout/Sidebar.tsx` | Collapse animation |
| 2 | `components/FileTabBar/FileTabBar.tsx` | Tab transitions |
| 2 | `components/ui/loading-overlay.tsx` | Fade in/out |
| 3 | `components/DDAResults.tsx` | Plot crossfade |
| 3 | `components/TimeSeriesPlotECharts.tsx` | Chart loading |
| 3 | `components/ui/dialog.tsx` | Modal animation |
| 4 | Various UI components | Micro-interactions |

## Success Criteria

- [ ] All buttons/inputs have smooth hover/focus transitions
- [ ] Sidebar collapse/expand is animated
- [ ] Tab switching has content fade
- [ ] Loading states crossfade to content
- [ ] Modals/dialogs animate in/out
- [ ] No instant state changes for visible UI elements
- [ ] Maintains 60fps during all animations

## Accessibility

- Respect `prefers-reduced-motion` media query
- Keep all transitions under 500ms
- Ensure animations don't block interaction
- Focus states remain clearly visible

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Risk Assessment

**Low Risk:** All changes are CSS-only or additive. No business logic modifications. Easy to revert if needed.
