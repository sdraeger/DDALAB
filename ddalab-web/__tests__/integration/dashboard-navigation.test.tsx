import React from "react";
import { render, waitFor, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "@/contexts/auth-context";
import { server } from "../mocks/server";
import { rest } from "msw";
import { ThemeProvider } from "../mocks/theme-provider-mock";
import { DashboardTabs } from "@/components/dashboard-tabs";

// API base URL for tests
const API_URL = "http://localhost";

// Create a wrapper with all required providers
const AllProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
};

// Mock authenticated user
jest.mock("@/lib/auth", () => {
  return {
    isAuthenticated: jest.fn().mockReturnValue(true),
    getCurrentUser: jest.fn().mockReturnValue({
      id: "1",
      username: "testuser",
      name: "Test User",
    }),
    loginUser: jest.fn(),
    logoutUser: jest.fn(),
  };
});

// Mock router
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    pathname: "/dashboard",
  }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

// Setup API mock handlers
beforeAll(() => {
  server.listen();

  // Add data endpoints
  server.use(
    // EEG data endpoint
    rest.get(`${API_URL}/api/eeg/data`, (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json({
          data: Array(100)
            .fill(0)
            .map((_, i) => ({
              time: i,
              value: Math.random() * 100,
            })),
        })
      );
    }),

    // Files endpoint
    rest.get(`${API_URL}/api/files`, (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json([
          {
            id: "1",
            name: "test.edf",
            path: "/data/test.edf",
            size: 1024,
            modified: new Date().toISOString(),
          },
          {
            id: "2",
            name: "sample.edf",
            path: "/data/sample.edf",
            size: 2048,
            modified: new Date().toISOString(),
          },
        ])
      );
    }),

    // Tickets endpoint
    rest.get(`${API_URL}/api/tickets`, (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json([
          {
            id: "1",
            title: "Test Ticket",
            description: "Test Description",
            status: "open",
            created_at: new Date().toISOString(),
          },
        ])
      );
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  jest.clearAllMocks();
});

afterAll(() => server.close());

describe("Dashboard Navigation Integration Test", () => {
  test.skip("renders all dashboard tabs correctly", async () => {
    render(<DashboardTabs />, { wrapper: AllProviders });

    // Check that all tab buttons are rendered
    expect(
      screen.getByRole("tab", { name: /EEG Visualization/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Files/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Tickets/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Settings/i })).toBeInTheDocument();
  });

  test.skip("can switch between tabs", async () => {
    render(<DashboardTabs />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // EEG tab should be default active tab
    expect(
      screen.getByRole("tab", { name: /EEG Visualization/i })
    ).toHaveAttribute("aria-selected", "true");

    // Switch to Files tab
    await user.click(screen.getByRole("tab", { name: /Files/i }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Files/i })).toHaveAttribute(
        "aria-selected",
        "true"
      );
      expect(screen.getByText(/Upload Files/i)).toBeInTheDocument();
    });

    // Switch to Tickets tab
    await user.click(screen.getByRole("tab", { name: /Tickets/i }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Tickets/i })).toHaveAttribute(
        "aria-selected",
        "true"
      );
      expect(screen.getByText(/My Tickets/i)).toBeInTheDocument();
    });

    // Switch to Settings tab
    await user.click(screen.getByRole("tab", { name: /Settings/i }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Settings/i })).toHaveAttribute(
        "aria-selected",
        "true"
      );
      expect(screen.getByText(/User Settings/i)).toBeInTheDocument();
    });
  });

  test.skip("EEG visualization tab loads data correctly", async () => {
    render(<DashboardTabs />, { wrapper: AllProviders });

    // Make sure EEG tab is active
    expect(
      screen.getByRole("tab", { name: /EEG Visualization/i })
    ).toHaveAttribute("aria-selected", "true");

    // Check that chart controls are rendered
    await waitFor(() => {
      expect(screen.getByText(/Select EEG File/i)).toBeInTheDocument();
      expect(screen.getByText(/Channel/i)).toBeInTheDocument();
    });
  });

  test.skip("Files tab shows file list correctly", async () => {
    render(<DashboardTabs />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Switch to Files tab
    await user.click(screen.getByRole("tab", { name: /Files/i }));

    // Check that file list is rendered with correct files
    await waitFor(() => {
      expect(screen.getByText(/test.edf/i)).toBeInTheDocument();
      expect(screen.getByText(/sample.edf/i)).toBeInTheDocument();
    });
  });

  test.skip("Tickets tab shows tickets correctly", async () => {
    render(<DashboardTabs />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Switch to Tickets tab
    await user.click(screen.getByRole("tab", { name: /Tickets/i }));

    // Check that tickets are rendered
    await waitFor(() => {
      expect(screen.getByText(/Test Ticket/i)).toBeInTheDocument();
    });
  });
});
