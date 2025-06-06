import { render, screen } from "@testing-library/react";

// Mock Next.js hooks
const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: jest.fn(() => "/login"),
}));

// Mock NextAuth with a simpler approach
jest.mock("next-auth/react", () => ({
  useSession: jest.fn(),
}));

// Mock the LoginForm component
jest.mock("shared/components/form/LoginForm", () => ({
  LoginForm: () => <div data-testid="login-form" />,
}));

import { useSession } from "next-auth/react";
import LoginPage from "../../app/login/page";

const mockUseSession = useSession as jest.Mock;

describe("Login Page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset pathname mock
    const usePathname = require("next/navigation").usePathname;
    usePathname.mockReturnValue("/login");
  });

  it("should render loading state when session is loading", () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: "loading",
    });

    render(<LoginPage />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("should render login form when user is not authenticated", () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: "unauthenticated",
    });

    render(<LoginPage />);

    // Check for actual form elements instead of test id
    expect(screen.getByText("Login to DDALAB")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
  });

  it("should redirect to dashboard when user is authenticated", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { id: "1", name: "Test User" },
        accessToken: "test-token",
      },
      status: "authenticated",
    });

    render(<LoginPage />);

    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
  });

  it("should show redirecting state when authenticated and redirecting", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { id: "1", name: "Test User" },
        accessToken: "test-token",
      },
      status: "authenticated",
    });

    render(<LoginPage />);

    expect(screen.getByText("Redirecting...")).toBeInTheDocument();
  });

  it("should not redirect when already on dashboard", () => {
    const usePathname = require("next/navigation").usePathname;
    usePathname.mockReturnValue("/dashboard");

    mockUseSession.mockReturnValue({
      data: {
        user: { id: "1", name: "Test User" },
        accessToken: "test-token",
      },
      status: "authenticated",
    });

    render(<LoginPage />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("should have proper main element structure", () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: "unauthenticated",
    });

    render(<LoginPage />);

    const main = screen.getByRole("main");
    expect(main).toBeInTheDocument();
    expect(main).toHaveClass("flex", "min-h-[calc(100vh-3.5rem)]", "flex-col");
  });
});
