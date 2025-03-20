// Define mockUserData before any imports or mocks
const mockUserData = {
  id: "1",
  username: "testuser",
  name: "Test User",
  email: "test@example.com",
  preferences: {
    theme: "light",
    notifications: {
      email: true,
      push: false,
    },
    sessionExpiration: 30,
  },
};

// Mocks must be defined before imports
jest.mock("../../contexts/auth-context", () => {
  return {
    useAuth: () => ({
      isAuthenticated: jest.fn().mockReturnValue(true),
      getCurrentUser: jest.fn().mockReturnValue(mockUserData),
      loginUser: jest.fn(),
      logoutUser: jest.fn(),
      getAuthToken: jest.fn().mockReturnValue("mock-token"),
      authLoading: false,
    }),
  };
});

jest.mock("next/navigation", () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
    };
  },
}));

jest.mock("../../components/ui/toast", () => {
  return {
    useToast: () => ({
      toast: jest.fn(),
    }),
  };
});

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { rest } from "msw";
import { ApolloProvider } from "@apollo/client";
import { ThemeProvider } from "../mocks/theme-provider-mock";
import UserSettings from "../../components/user-settings";
import { createMockClient } from "../mocks/apollo-mock";

// Mock AllProviders component
const AllProviders = ({ children }: { children: React.ReactNode }) => (
  <ApolloProvider client={createMockClient()}>
    <ThemeProvider>{children}</ThemeProvider>
  </ApolloProvider>
);

// Setup MSW server
const server = setupServer(
  rest.get("/api/users/profile", (req, res, ctx) => {
    return res(ctx.status(200), ctx.json(mockUserData));
  }),
  rest.put("/api/users/profile", (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({ ...mockUserData, name: "Updated Name" })
    );
  }),
  rest.put("/api/users/preferences", (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        ...mockUserData,
        preferences: {
          ...mockUserData.preferences,
          theme: "dark",
        },
      })
    );
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("User Profile Integration Tests", () => {
  test("renders user profile settings correctly", async () => {
    render(<UserSettings />, { wrapper: AllProviders });

    await waitFor(() => {
      expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
      expect(screen.getByLabelText("Email")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /light/i })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /dark/i })).toBeInTheDocument();
      expect(
        screen.getByRole("checkbox", { name: /email notifications/i })
      ).toBeInTheDocument();
    });
  });

  test("can update user information", async () => {
    render(<UserSettings />, { wrapper: AllProviders });
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText(/^name$/i);
    const saveButton = screen.getByRole("button", { name: /save profile/i });

    await user.clear(nameInput);
    await user.type(nameInput, "Updated Name");
    await user.click(saveButton);

    await waitFor(() => {
      expect(
        screen.getByText(/Profile updated successfully/i)
      ).toBeInTheDocument();
    });
  });

  test("can change theme preference", async () => {
    render(<UserSettings />, { wrapper: AllProviders });
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    });

    const darkThemeRadio = screen.getByRole("radio", { name: /dark/i });
    const saveButton = screen.getByRole("button", {
      name: /save preferences/i,
    });

    await user.click(darkThemeRadio);
    await user.click(saveButton);

    await waitFor(() => {
      expect(
        screen.getByText(/Settings saved successfully/i)
      ).toBeInTheDocument();
    });
  });

  test("can toggle notification settings", async () => {
    render(<UserSettings />, { wrapper: AllProviders });
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    });

    const emailNotificationsCheckbox = screen.getByRole("checkbox", {
      name: /email notifications/i,
    });
    const saveButton = screen.getByRole("button", {
      name: /save preferences/i,
    });

    await user.click(emailNotificationsCheckbox);
    await user.click(saveButton);

    await waitFor(() => {
      expect(
        screen.getByText(/Settings saved successfully/i)
      ).toBeInTheDocument();
    });
  });
});
