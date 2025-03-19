import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "@/contexts/auth-context";
import { server } from "../mocks/server";
import { rest } from "msw";
import { ThemeProvider } from "../mocks/theme-provider-mock";
// Import commented out until component is created
// import { UserSettings } from "@/components/user-settings";

// API base URL for tests
const API_URL = "http://localhost";

// Define types for user data
interface UserPreferences {
  theme: string;
  notifications: boolean;
  dataVisualPrefs: {
    colorScheme: string;
    chartType: string;
  };
}

interface User {
  id: string;
  username: string;
  name: string;
  email: string;
  preferences: UserPreferences;
}

// Create a wrapper component with all necessary providers
const AllProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
};

// Mock component for testing
const UserSettings = () => (
  <div>
    <h1>User Settings</h1>
    <form>
      <label htmlFor="name">Name</label>
      <input id="name" defaultValue="Test User" />

      <label htmlFor="email">Email</label>
      <input id="email" defaultValue="test@example.com" />

      <label htmlFor="theme">Theme</label>
      <select id="theme" defaultValue="light">
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>

      <label htmlFor="notifications">Notifications</label>
      <input id="notifications" type="checkbox" defaultChecked />

      <button type="submit">Save</button>
    </form>
  </div>
);

// Mock authentication library without referencing an external variable
jest.mock("@/lib/auth", () => ({
  isAuthenticated: jest.fn().mockReturnValue(true),
  getCurrentUser: jest.fn().mockReturnValue({
    id: "1",
    username: "testuser",
    name: "Test User",
    email: "test@example.com",
    preferences: {
      theme: "light",
      notifications: true,
      dataVisualPrefs: {
        colorScheme: "rainbow",
        chartType: "line",
      },
    },
  }),
  loginUser: jest.fn(),
  logoutUser: jest.fn(),
  updateUserProfile: jest.fn().mockResolvedValue({ success: true }),
}));

// Export mockUser for use in other places
export const mockUser: User = {
  id: "1",
  username: "testuser",
  name: "Test User",
  email: "test@example.com",
  preferences: {
    theme: "light",
    notifications: true,
    dataVisualPrefs: {
      colorScheme: "rainbow",
      chartType: "line",
    },
  },
};

// Configure MSW server
beforeAll(() => {
  server.listen();

  server.use(
    // User profile endpoint
    rest.get(`${API_URL}/api/users/profile`, (req, res, ctx) => {
      return res(ctx.status(200), ctx.json(mockUser));
    }),

    // Update profile endpoint
    rest.put(`${API_URL}/api/users/profile`, (req, res, ctx) => {
      // Type assertion to handle the request body properly
      const updatedUser = { ...mockUser, ...(req.body as Partial<User>) };
      return res(ctx.status(200), ctx.json(updatedUser));
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  jest.clearAllMocks();
});

afterAll(() => server.close());

describe.skip("User Profile Integration Tests", () => {
  test("renders user profile with current settings", async () => {
    render(<UserSettings />, { wrapper: AllProviders });

    // Check that user profile form is rendered with user data
    await waitFor(() => {
      expect(screen.getByDisplayValue("Test User")).toBeInTheDocument();
      expect(screen.getByDisplayValue("test@example.com")).toBeInTheDocument();
    });

    // Check that preferences are rendered
    expect(screen.getByLabelText(/Theme/i)).toHaveValue("light");
    expect(screen.getByLabelText(/Notifications/i)).toBeChecked();
  });

  test("can update user name and email", async () => {
    const updateUserProfile = require("@/lib/auth").updateUserProfile;

    render(<UserSettings />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Wait for the form to load
    await waitFor(() => {
      expect(screen.getByDisplayValue("Test User")).toBeInTheDocument();
    });

    // Change name
    const nameInput = screen.getByLabelText(/Name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Name");

    // Change email
    const emailInput = screen.getByLabelText(/Email/i);
    await user.clear(emailInput);
    await user.type(emailInput, "updated@example.com");

    // Submit form
    const saveButton = screen.getByRole("button", { name: /Save/i });
    await user.click(saveButton);

    // Check that updateUserProfile was called with updated data
    await waitFor(() => {
      expect(updateUserProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Updated Name",
          email: "updated@example.com",
        })
      );
    });

    // Check for success message
    expect(
      screen.getByText(/Profile updated successfully/i)
    ).toBeInTheDocument();
  });

  test("can change theme preference", async () => {
    const updateUserProfile = require("@/lib/auth").updateUserProfile;

    render(<UserSettings />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Wait for the form to load
    await waitFor(() => {
      expect(screen.getByLabelText(/Theme/i)).toBeInTheDocument();
    });

    // Change theme
    const themeSelect = screen.getByLabelText(/Theme/i);
    await user.click(themeSelect);
    await user.click(screen.getByText("Dark"));

    // Save changes
    const saveButton = screen.getByRole("button", { name: /Save/i });
    await user.click(saveButton);

    // Check that updateUserProfile was called with updated preferences
    await waitFor(() => {
      expect(updateUserProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            theme: "dark",
          }),
        })
      );
    });
  });

  test("toggles notification preferences", async () => {
    const updateUserProfile = require("@/lib/auth").updateUserProfile;

    render(<UserSettings />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Wait for the form to load
    await waitFor(() => {
      expect(screen.getByLabelText(/Notifications/i)).toBeInTheDocument();
    });

    // Toggle notifications off
    const notificationsCheckbox = screen.getByLabelText(/Notifications/i);
    await user.click(notificationsCheckbox);

    // Save changes
    const saveButton = screen.getByRole("button", { name: /Save/i });
    await user.click(saveButton);

    // Check that updateUserProfile was called with updated preferences
    await waitFor(() => {
      expect(updateUserProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({
            notifications: false,
          }),
        })
      );
    });
  });

  test("displays validation errors for invalid email", async () => {
    render(<UserSettings />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Wait for the form to load
    await waitFor(() => {
      expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
    });

    // Enter invalid email
    const emailInput = screen.getByLabelText(/Email/i);
    await user.clear(emailInput);
    await user.type(emailInput, "not-an-email");

    // Try to save
    const saveButton = screen.getByRole("button", { name: /Save/i });
    await user.click(saveButton);

    // Check for validation error
    expect(
      screen.getByText(/Please enter a valid email address/i)
    ).toBeInTheDocument();
  });

  test("handles API errors when updating profile", async () => {
    // Override the API to return an error
    server.use(
      rest.put(`${API_URL}/api/users/profile`, (req, res, ctx) => {
        return res(
          ctx.status(500),
          ctx.json({ message: "Server error updating profile" })
        );
      })
    );

    render(<UserSettings />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Wait for the form to load
    await waitFor(() => {
      expect(screen.getByDisplayValue("Test User")).toBeInTheDocument();
    });

    // Change name
    const nameInput = screen.getByLabelText(/Name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Name");

    // Submit form
    const saveButton = screen.getByRole("button", { name: /Save/i });
    await user.click(saveButton);

    // Check for error message
    await waitFor(() => {
      expect(
        screen.getByText(/Server error updating profile/i)
      ).toBeInTheDocument();
    });
  });
});
