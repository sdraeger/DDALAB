import React, { FC, ReactElement } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { AuthProvider } from "@/contexts/auth-context";
import { ThemeProvider } from "../mocks/theme-provider-mock";

// Define a custom render function that includes all providers
const AllProviders: FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <ThemeProvider>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
};

// Custom render function with all providers
const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">
) => render(ui, { wrapper: AllProviders, ...options });

// Re-export everything from React Testing Library
export * from "@testing-library/react";

// Override render method
export { customRender as render };
