import React from "react";
import { render, waitFor, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "@/contexts/auth-context";
import { server } from "../mocks/server";
import { rest } from "msw";
import { ThemeProvider } from "../mocks/theme-provider-mock";
import { HelpButton } from "@/components/help-button";

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

// Mock the useToast hook
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

// Additional MSW handlers for ticket APIs
beforeAll(() => {
  // Add ticket endpoints to MSW handlers
  server.listen();
  server.use(
    // Fetch tickets
    rest.get(`${API_URL}/api/tickets`, (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json([
          {
            id: "1",
            title: "Existing Ticket",
            description: "This is an existing ticket",
            status: "open",
            created_at: "2023-05-15T10:00:00Z",
            updated_at: "2023-05-15T10:00:00Z",
            user: {
              id: "1",
              username: "testuser",
            },
          },
        ])
      );
    }),
    // Create ticket
    rest.post(`${API_URL}/api/tickets`, (req, res, ctx) => {
      return res(
        ctx.status(201),
        ctx.json({
          id: "2",
          title: "New Test Ticket",
          description: "This is a test ticket",
          status: "open",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          user: {
            id: "1",
            username: "testuser",
          },
        })
      );
    }),
    // Add mock for the Next.js API route
    rest.post(`/api/tickets`, (req, res, ctx) => {
      return res(
        ctx.status(201),
        ctx.json({
          id: "2",
          title: "New Test Ticket",
          description: "This is a test ticket",
          status: "open",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          user: {
            id: "1",
            username: "testuser",
          },
        })
      );
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  jest.clearAllMocks();
});

afterAll(() => server.close());

// Mock localStorage
beforeEach(() => {
  // Setup localStorage mock
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: jest.fn().mockReturnValue("mock-token"),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    },
    writable: true,
  });
});

describe("Help Ticket Integration Test", () => {
  test("can open help dialog and submit a ticket", async () => {
    render(<HelpButton />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Click the help button to open dialog
    await user.click(screen.getByRole("button", { name: /Get help/i }));

    // Wait for the dialog to be visible
    await waitFor(() => {
      expect(screen.getByText(/Get Help/i)).toBeInTheDocument();
    });

    // Fill in the ticket form
    await user.type(screen.getByLabelText(/Title/i), "Test Ticket");
    await user.type(
      screen.getByLabelText(/Description/i),
      "This is a test description for the help ticket"
    );

    // Submit the form
    await user.click(screen.getByRole("button", { name: /Submit Ticket/i }));

    // Wait for the dialog to close after submission
    await waitFor(() => {
      expect(screen.queryByText(/Get Help/i)).not.toBeInTheDocument();
    });
  });

  test("handles validation errors in ticket form", async () => {
    render(<HelpButton />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Click the help button to open dialog
    await user.click(screen.getByRole("button", { name: /Get help/i }));

    // Wait for the dialog to be visible
    await waitFor(() => {
      expect(screen.getByText(/Get Help/i)).toBeInTheDocument();
    });

    // Submit without filling in the form
    await user.click(screen.getByRole("button", { name: /Submit Ticket/i }));

    // Dialog should still be open
    expect(screen.getByText(/Get Help/i)).toBeInTheDocument();
  });

  test("handles API errors when submitting ticket", async () => {
    // Override the API to return an error
    server.use(
      rest.post(`/api/tickets`, (req, res, ctx) => {
        return res(ctx.status(500), ctx.json({ message: "Server error" }));
      })
    );

    render(<HelpButton />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Click the help button to open dialog
    await user.click(screen.getByRole("button", { name: /Get help/i }));

    // Wait for the dialog to be visible
    await waitFor(() => {
      expect(screen.getByText(/Get Help/i)).toBeInTheDocument();
    });

    // Fill in the ticket form
    await user.type(screen.getByLabelText(/Title/i), "Test Ticket");
    await user.type(
      screen.getByLabelText(/Description/i),
      "This is a test description for the help ticket"
    );

    // Submit the form
    await user.click(screen.getByRole("button", { name: /Submit Ticket/i }));

    // Dialog should still be open
    expect(screen.getByText(/Get Help/i)).toBeInTheDocument();
  });
});
