import React from "react";

// Mock theme provider that doesn't use window.matchMedia
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  return <div data-testid="theme-provider-mock">{children}</div>;
};
