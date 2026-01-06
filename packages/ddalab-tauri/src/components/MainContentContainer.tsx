"use client";

import { cn } from "@/lib/utils";

interface MainContentContainerProps {
  children: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * MainContentContainer provides an elegant scrolling experience for the main content area.
 *
 * Features:
 * - Styled native scrollbar that's always visible when content overflows
 * - Wider scrollbar track for easier grabbing
 * - Smooth scroll behavior
 * - overscroll-behavior: contain to prevent scroll chaining
 */
export function MainContentContainer({
  children,
  className,
  "data-testid": testId,
}: MainContentContainerProps) {
  return (
    <div
      className={cn(
        "flex-1 overflow-y-auto overflow-x-hidden styled-scrollbar",
        className,
      )}
      style={{
        overscrollBehavior: "contain",
      }}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
