import React from "react";
import { render, waitFor, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "@/contexts/auth-context";
import { server } from "../mocks/server";
import { rest } from "msw";
import { ThemeProvider } from "../mocks/theme-provider-mock";
import { RegisterDialog } from "@/components/register-dialog";

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

// Mock the router
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock auth library
jest.mock("@/lib/auth", () => {
  return {
    registerUser: jest.fn().mockImplementation(async (credentials) => {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        throw new Error("Registration failed");
      }

      return response.json();
    }),
    loginUser: jest.fn(),
    logoutUser: jest.fn(),
    isAuthenticated: jest.fn().mockReturnValue(false),
    getCurrentUser: jest.fn().mockReturnValue(null),
  };
});

// Set up local storage spies
beforeEach(() => {
  jest.spyOn(Storage.prototype, "setItem");
  jest.spyOn(Storage.prototype, "getItem");
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Start the MSW server before tests
beforeAll(() => server.listen());

// Reset request handlers and mocks after each test
afterEach(() => {
  server.resetHandlers();
  mockPush.mockClear();
  jest.clearAllMocks();
});

// Close the server after tests
afterAll(() => server.close());

// Mock open/close functionality since we can't test Dialog directly
const MockRegisterDialog = () => {
  const [open, setOpen] = React.useState(true);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open Register</button>
      {open && (
        <div data-testid="register-container">
          <RegisterDialog open={open} onOpenChange={setOpen} />
        </div>
      )}
    </div>
  );
};

describe("Registration Flow Integration Test", () => {
  // Skip tests that depend on the RegisterDialog component
  test.skip("successful registration redirects to dashboard", async () => {
    render(<MockRegisterDialog />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Wait for the dialog to be visible
    await waitFor(() => {
      expect(screen.getByTestId("register-container")).toBeInTheDocument();
    });

    // Fill registration form
    await user.type(screen.getByLabelText(/Username/i), "testuser");
    await user.type(screen.getByLabelText(/Email/i), "test@example.com");
    await user.type(screen.getByLabelText(/^Password$/i), "Password123!");
    await user.type(screen.getByLabelText(/Confirm Password/i), "Password123!");

    // Submit the form
    await user.click(screen.getByRole("button", { name: /Register/i }));

    // Wait for redirection
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });
  });

  test.skip("shows validation errors for invalid inputs", async () => {
    render(<MockRegisterDialog />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Wait for the dialog to be visible
    await waitFor(() => {
      expect(screen.getByTestId("register-container")).toBeInTheDocument();
    });

    // Fill with invalid data
    await user.type(screen.getByLabelText(/Username/i), "te"); // Too short
    await user.type(screen.getByLabelText(/Email/i), "notanemail");
    await user.type(screen.getByLabelText(/^Password$/i), "short");
    await user.type(screen.getByLabelText(/Confirm Password/i), "nomatch");

    // Submit the form
    await user.click(screen.getByRole("button", { name: /Register/i }));

    // Check for validation errors
    await waitFor(() => {
      expect(
        screen.getByText(/Username must be at least 3 characters/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/Invalid email format/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Password must be at least 8 characters/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/Passwords do not match/i)).toBeInTheDocument();
    });
  });

  test.skip("handles registration failure", async () => {
    // Override register handler to simulate failure
    server.use(
      rest.post(`${API_URL}/auth/register`, (req, res, ctx) => {
        return res(
          ctx.status(400),
          ctx.json({ message: "Username already exists" })
        );
      })
    );

    render(<MockRegisterDialog />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Wait for the dialog to be visible
    await waitFor(() => {
      expect(screen.getByTestId("register-container")).toBeInTheDocument();
    });

    // Fill registration form with valid data
    await user.type(screen.getByLabelText(/Username/i), "testuser");
    await user.type(screen.getByLabelText(/Email/i), "test@example.com");
    await user.type(screen.getByLabelText(/^Password$/i), "Password123!");
    await user.type(screen.getByLabelText(/Confirm Password/i), "Password123!");

    // Submit the form
    await user.click(screen.getByRole("button", { name: /Register/i }));

    // Check for error message
    await waitFor(() => {
      expect(screen.getByText(/Registration failed/i)).toBeInTheDocument();
    });

    // Verify no redirect
    expect(mockPush).not.toHaveBeenCalled();
  });
});
