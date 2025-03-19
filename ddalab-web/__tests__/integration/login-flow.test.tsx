import React from "react";
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "@/components/login-form";
import { AuthProvider } from "@/contexts/auth-context";
import { server } from "../mocks/server";
import { rest } from "msw";
import { ThemeProvider } from "../mocks/theme-provider-mock";
import { useRouter } from "next/navigation";

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

// Mock auth library but avoid referencing window
jest.mock("@/lib/auth", () => {
  return {
    loginUser: jest.fn().mockImplementation(async (credentials) => {
      const response = await fetch(`http://localhost/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        throw new Error("Login failed");
      }

      const data = await response.json();
      return data;
    }),
    logoutUser: jest.fn(),
    isAuthenticated: jest.fn().mockReturnValue(false),
    getCurrentUser: jest.fn().mockReturnValue(null),
    registerUser: jest.fn(),
  };
});

// Setup local storage mock
// Instead of the complex mock object, use jest.spyOn
beforeEach(() => {
  // Setup simple local storage spy without mock implementation
  jest.spyOn(Storage.prototype, "setItem");
  jest.spyOn(Storage.prototype, "getItem");
  jest.spyOn(Storage.prototype, "removeItem");
});

afterEach(() => {
  // Restore all mocks
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

describe("Login Flow Integration Test", () => {
  test("successful login redirects to dashboard and stores token", async () => {
    // Render the login form with all providers
    const { getByLabelText, getByRole } = render(<LoginForm />, {
      wrapper: AllProviders,
    });

    const user = userEvent.setup();

    // Fill login form
    await user.type(getByLabelText(/Username/i), "testuser");
    await user.type(getByLabelText(/Password/i), "password123");

    // Submit the form
    await user.click(getByRole("button", { name: /Login/i }));

    // Wait for the push to be called
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });
  });

  test("failed login shows error message and doesn't redirect", async () => {
    // Override login handler to simulate failed login
    server.use(
      rest.post(`${API_URL}/auth/login`, (req, res, ctx) => {
        return res(
          ctx.status(401),
          ctx.json({ message: "Invalid credentials" })
        );
      })
    );

    // Render the login form with all providers
    const { getByLabelText, getByRole, findByText } = render(<LoginForm />, {
      wrapper: AllProviders,
    });

    const user = userEvent.setup();

    // Fill login form
    await user.type(getByLabelText(/Username/i), "testuser");
    await user.type(getByLabelText(/Password/i), "wrongpassword");

    // Submit the form
    await user.click(getByRole("button", { name: /Login/i }));

    // Check for error message
    const errorMessage = await findByText(/Login failed/i);
    expect(errorMessage).toBeInTheDocument();

    // Verify no redirect happened
    expect(mockPush).not.toHaveBeenCalled();

    // Verify no token was stored
    expect(jest.spyOn(Storage.prototype, "setItem")).not.toHaveBeenCalledWith(
      "token",
      expect.any(String)
    );
  });
});
