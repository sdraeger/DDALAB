"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

interface PopoverProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function Popover({
  open: controlledOpen,
  onOpenChange,
  children,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = React.useCallback(
    (value: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(value);
      }
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange],
  );

  return (
    <PopoverContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block">{children}</div>
    </PopoverContext.Provider>
  );
}

interface PopoverTriggerProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
  children: React.ReactNode;
}

const PopoverTrigger = React.forwardRef<HTMLDivElement, PopoverTriggerProps>(
  ({ asChild, children, onClick, ...props }, ref) => {
    const context = React.useContext(PopoverContext);
    if (!context) {
      throw new Error("PopoverTrigger must be used within a Popover");
    }

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
      context.setOpen(!context.open);
      onClick?.(e);
    };

    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement<any>, {
        onClick: handleClick,
        ref,
      });
    }

    return (
      <div ref={ref} onClick={handleClick} {...props}>
        {children}
      </div>
    );
  },
);
PopoverTrigger.displayName = "PopoverTrigger";

interface PopoverContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  sideOffset?: number;
}

const ANIMATION_DURATION = 150; // ms

const PopoverContent = React.forwardRef<HTMLDivElement, PopoverContentProps>(
  (
    {
      className,
      align = "center",
      side = "bottom",
      sideOffset = 4,
      children,
      ...props
    },
    ref,
  ) => {
    const context = React.useContext(PopoverContext);
    const contentRef = React.useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = React.useState(false);
    const [isClosing, setIsClosing] = React.useState(false);

    if (!context) {
      throw new Error("PopoverContent must be used within a Popover");
    }

    // Handle open/close with animation
    React.useEffect(() => {
      if (context.open) {
        setIsVisible(true);
        setIsClosing(false);
      } else if (isVisible) {
        // Start close animation
        setIsClosing(true);
        const timer = setTimeout(() => {
          setIsVisible(false);
          setIsClosing(false);
        }, ANIMATION_DURATION);
        return () => clearTimeout(timer);
      }
    }, [context.open, isVisible]);

    // Close on outside click
    React.useEffect(() => {
      if (!context.open) return;

      const handleClickOutside = (e: MouseEvent) => {
        if (
          contentRef.current &&
          !contentRef.current.contains(e.target as Node)
        ) {
          // Check if the click was on the trigger
          const trigger = contentRef.current.parentElement?.querySelector(
            "[data-popover-trigger]",
          );
          if (trigger && trigger.contains(e.target as Node)) {
            return;
          }
          context.setOpen(false);
        }
      };

      // Delay to avoid immediate close
      const timer = setTimeout(() => {
        document.addEventListener("mousedown", handleClickOutside);
      }, 0);

      return () => {
        clearTimeout(timer);
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }, [context.open, context]);

    // Close on escape
    React.useEffect(() => {
      if (!context.open) return;

      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          context.setOpen(false);
        }
      };

      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }, [context.open, context]);

    if (!isVisible) return null;

    const sideStyles =
      side === "top"
        ? { bottom: `calc(100% + ${sideOffset}px)` }
        : { marginTop: sideOffset };

    return (
      <div
        ref={(node) => {
          contentRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        className={cn(
          "absolute z-50 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
          isClosing
            ? "animate-out fade-out-0 zoom-out-95"
            : "animate-in fade-in-0 zoom-in-95",
          isClosing
            ? side === "top"
              ? "slide-out-to-bottom-2"
              : "slide-out-to-top-2"
            : side === "top"
              ? "slide-in-from-bottom-2"
              : "slide-in-from-top-2",
          align === "start" && "left-0",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "end" && "right-0",
          className,
        )}
        style={{
          ...sideStyles,
          animationDuration: `${ANIMATION_DURATION}ms`,
        }}
        {...props}
      >
        {children}
      </div>
    );
  },
);
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverTrigger, PopoverContent };
