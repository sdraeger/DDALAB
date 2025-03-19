import { render } from "../utils/test-utils";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginForm } from "@/components/login-form";
import { server } from "../mocks/server";
import { rest } from "msw";
import { config } from "@/lib/config";

// API base URL for tests
const API_URL = "http://localhost";

// Start the MSW server before tests
beforeAll(() => server.listen());

// Reset request handlers after each test
afterEach(() => server.resetHandlers());

// Close the server after tests
afterAll(() => server.close());

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
  };
});

describe("LoginForm Component", () => {
  test("renders login form correctly", () => {
    render(<LoginForm />);

    // Check if form elements are present
    expect(screen.getByText(/Login to DDALAB/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Login/i })).toBeInTheDocument();
  });

  test("validates required fields", async () => {
    render(<LoginForm />);

    // Submit the form without filling any fields
    fireEvent.click(screen.getByRole("button", { name: /Login/i }));

    // Check if validation errors are displayed
    await waitFor(() => {
      expect(screen.getByText(/Username is required/i)).toBeInTheDocument();
      expect(screen.getByText(/Password is required/i)).toBeInTheDocument();
    });
  });

  test("handles successful login", async () => {
    render(<LoginForm />);

    // Fill in form fields
    fireEvent.change(screen.getByLabelText(/Username/i), {
      target: { value: "testuser" },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: "password123" },
    });

    // Submit the form
    fireEvent.click(screen.getByRole("button", { name: /Login/i }));

    // Check if login process is handled correctly (loading state, no errors)
    await waitFor(() => {
      expect(screen.queryByText(/Login failed/i)).not.toBeInTheDocument();
    });
  });

  test("handles login error", async () => {
    // Override the default handler to simulate an error
    server.use(
      rest.post(`${API_URL}/auth/login`, (req, res, ctx) => {
        return res(
          ctx.status(401),
          ctx.json({ message: "Invalid credentials" })
        );
      })
    );

    render(<LoginForm />);

    // Fill in form fields
    fireEvent.change(screen.getByLabelText(/Username/i), {
      target: { value: "testuser" },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: "wrongpassword" },
    });

    // Submit the form
    fireEvent.click(screen.getByRole("button", { name: /Login/i }));

    // Check if error message is displayed
    await waitFor(() => {
      expect(screen.getByText(/Login failed/i)).toBeInTheDocument();
    });
  });
});
