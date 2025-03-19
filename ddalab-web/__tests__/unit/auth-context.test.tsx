import React, { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { server } from "../mocks/server";
import { rest } from "msw";

// API base URL for tests
const API_URL = "http://localhost";

// Mock the next/navigation functionality
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

// Mock auth library
jest.mock("@/lib/auth", () => {
  return {
    loginUser: jest.fn().mockImplementation(async (credentials) => {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        throw new Error("Login failed");
      }

      return response.json();
    }),
    logoutUser: jest.fn(),
    isAuthenticated: jest.fn().mockReturnValue(false),
    getCurrentUser: jest.fn().mockReturnValue(null),
    registerUser: jest.fn(),
  };
});

// Start the MSW server before tests
beforeAll(() => server.listen());

// Reset request handlers after each test
afterEach(() => server.resetHandlers());

// Close the server after tests
afterAll(() => server.close());

// Test component that uses the auth context
const TestComponent = () => {
  const { user, login, logout, isLoggedIn } = useAuth();

  return (
    <div>
      <div data-testid="user-status">
        {isLoggedIn ? "Logged In" : "Logged Out"}
      </div>
      <div data-testid="user-info">{user ? user.username : "No user"}</div>
      <button
        onClick={() => login({ username: "testuser", password: "password" })}
        data-testid="login-button"
      >
        Log In
      </button>
      <button onClick={() => logout()} data-testid="logout-button">
        Log Out
      </button>
    </div>
  );
};

// Create a TestComponentWithTryCatch that handles the expected error
const TestComponentWithTryCatch = () => {
  const { user, login, logout, isLoggedIn } = useAuth();
  const [loginError, setLoginError] = useState(false);

  const handleLogin = async () => {
    try {
      await login({ username: "testuser", password: "wrongpassword" });
    } catch (error) {
      setLoginError(true);
    }
  };

  return (
    <div>
      <div data-testid="user-status">
        {isLoggedIn ? "Logged In" : "Logged Out"}
      </div>
      <div data-testid="user-info">{user ? user.username : "No user"}</div>
      <div data-testid="login-error">
        {loginError ? "Error occurred" : "No error"}
      </div>
      <button onClick={handleLogin} data-testid="login-button">
        Log In
      </button>
      <button onClick={() => logout()} data-testid="logout-button">
        Log Out
      </button>
    </div>
  );
};

describe("AuthContext", () => {
  test("provides authentication state", () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    // Initially logged out
    expect(screen.getByTestId("user-status").textContent).toBe("Logged Out");
    expect(screen.getByTestId("user-info").textContent).toBe("No user");
  });

  test("handles login correctly", async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    // Click login button
    await user.click(screen.getByTestId("login-button"));

    // Wait for the state to update
    await waitFor(() => {
      expect(screen.getByTestId("user-status").textContent).toBe("Logged In");
      expect(screen.getByTestId("user-info").textContent).toBe("testuser");
    });
  });

  test("handles logout correctly", async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    // Login first
    await user.click(screen.getByTestId("login-button"));

    // Wait for the login to complete
    await waitFor(() => {
      expect(screen.getByTestId("user-status").textContent).toBe("Logged In");
    });

    // Logout
    await user.click(screen.getByTestId("logout-button"));

    // Check if logged out
    await waitFor(() => {
      expect(screen.getByTestId("user-status").textContent).toBe("Logged Out");
      expect(screen.getByTestId("user-info").textContent).toBe("No user");
    });
  });

  test("handles login error", async () => {
    // Override the default handler to simulate a server error
    server.use(
      rest.post(`${API_URL}/auth/login`, (req, res, ctx) => {
        return res(
          ctx.status(401),
          ctx.json({ message: "Invalid credentials" })
        );
      })
    );

    const user = userEvent.setup();

    render(
      <AuthProvider>
        <TestComponentWithTryCatch />
      </AuthProvider>
    );

    // Try to login
    await user.click(screen.getByTestId("login-button"));

    // Check if error is shown and user is still logged out
    await waitFor(() => {
      expect(screen.getByTestId("login-error").textContent).toBe(
        "Error occurred"
      );
      expect(screen.getByTestId("user-status").textContent).toBe("Logged Out");
      expect(screen.getByTestId("user-info").textContent).toBe("No user");
    });
  });
});
