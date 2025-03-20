import React from "react";
import { render, waitFor, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "@/contexts/auth-context";
import { server } from "../mocks/server";
import { rest } from "msw";
import { ThemeProvider } from "../mocks/theme-provider-mock";
import { DashboardTabs } from "@/components/dashboard-tabs";
import { EDFPlotProvider } from "@/contexts/edf-plot-context";
import { MockedProvider } from "@apollo/client/testing";
import {
  LIST_FILES_IN_PATH,
  GET_EDF_DATA,
  CREATE_ANNOTATION,
  UPDATE_ANNOTATION,
  DELETE_ANNOTATION,
} from "@/lib/graphql/queries";
import { TOGGLE_FAVORITE_FILE, SUBMIT_DDA_TASK } from "@/lib/graphql/mutations";
import { ToastProvider } from "@/components/ui/toast";

// API base URL for tests
const API_URL = "http://localhost";

// Include the mock handler for GraphQL
const mockGraphQLQueries = [
  {
    request: {
      query: LIST_FILES_IN_PATH,
      variables: {
        path: "",
      },
    },
    result: {
      data: {
        listFilesInPath: [
          {
            name: "test.edf",
            path: "/test.edf",
            isDirectory: false,
            size: 1000,
            lastModified: "2023-01-01T00:00:00Z",
            isFavorite: false,
          },
          {
            name: "folder",
            path: "/folder",
            isDirectory: true,
            size: 0,
            lastModified: "2023-01-01T00:00:00Z",
            isFavorite: false,
          },
        ],
      },
    },
  },
  {
    request: {
      query: GET_EDF_DATA,
      variables: {
        filename: "/test.edf",
        chunkStart: 0,
        chunkSize: 1000,
        preprocessingOptions: null,
        includeNavigationInfo: true,
      },
    },
    result: {
      data: {
        getEdfData: {
          data: [
            [0, 1, 2],
            [3, 4, 5],
            [6, 7, 8],
          ],
          samplingFrequency: 100,
          channelLabels: ["Channel 1", "Channel 2", "Channel 3"],
          totalSamples: 3000,
          chunkStart: 0,
          chunkSize: 1000,
          hasMore: true,
        },
      },
    },
  },
  {
    request: {
      query: CREATE_ANNOTATION,
      variables: {
        annotationInput: {
          filePath: "/test.edf",
          startTime: 0,
          endTime: 1,
          text: "Test annotation",
        },
      },
    },
    result: {
      data: {
        createAnnotation: {
          id: 1,
          userId: 1,
          filePath: "/test.edf",
          startTime: 0,
          endTime: 1,
          text: "Test annotation",
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T00:00:00Z",
        },
      },
    },
  },
  {
    request: {
      query: UPDATE_ANNOTATION,
      variables: {
        id: 1,
        annotationInput: {
          filePath: "/test.edf",
          startTime: 0,
          endTime: 2,
          text: "Updated annotation",
        },
      },
    },
    result: {
      data: {
        updateAnnotation: {
          id: 1,
          userId: 1,
          filePath: "/test.edf",
          startTime: 0,
          endTime: 2,
          text: "Updated annotation",
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T00:00:00Z",
        },
      },
    },
  },
  {
    request: {
      query: DELETE_ANNOTATION,
      variables: {
        id: 1,
      },
    },
    result: {
      data: {
        deleteAnnotation: true,
      },
    },
  },
  {
    request: {
      query: TOGGLE_FAVORITE_FILE,
      variables: {
        filePath: "/test.edf",
      },
    },
    result: {
      data: {
        toggleFavoriteFile: true,
      },
    },
  },
  {
    request: {
      query: SUBMIT_DDA_TASK,
      variables: {
        filePath: "/test.edf",
        preprocessingOptions: null,
      },
    },
    result: {
      data: {
        startDda: {
          taskId: "test-task-id",
          filePath: "/test.edf",
          status: "PENDING",
        },
      },
    },
  },
];

// Create a wrapper with all the needed providers
const AllProviders: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const mockAuthContext = {
    isAuthenticated: true,
    user: { username: "testuser", id: "1" },
    loading: false,
    login: jest.fn().mockResolvedValue(true),
    logout: jest.fn(),
    register: jest.fn(),
  };

  // Use the mock router already setup by jest.mock for next/navigation

  return (
    <MockedProvider mocks={mockGraphQLQueries} addTypename={false}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <EDFPlotProvider>{children}</EDFPlotProvider>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </MockedProvider>
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
    rest.get(`/api/files`, (req, res, ctx) => {
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
    rest.get(`/api/tickets`, (req, res, ctx) => {
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
  test("renders dashboard tabs correctly", async () => {
    render(<DashboardTabs />, { wrapper: AllProviders });

    // Check that the tab buttons are rendered based on the actual component
    expect(screen.getByRole("tab", { name: /EEG Files/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Tasks/i })).toBeInTheDocument();
  });

  test("can switch between tabs", async () => {
    render(<DashboardTabs />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // EEG Files tab should be default active tab
    expect(screen.getByRole("tab", { name: /EEG Files/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    // Switch to Tasks tab
    await user.click(screen.getByRole("tab", { name: /Tasks/i }));

    // Wait for Tasks tab to be selected
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Tasks/i })).toHaveAttribute(
        "aria-selected",
        "true"
      );
      expect(
        screen.getByText(
          /No active tasks. Submit a DDA task to see task status here./i
        )
      ).toBeInTheDocument();
    });
  });

  test("EEG Files tab displays file selection message", async () => {
    render(<DashboardTabs />, { wrapper: AllProviders });

    // Make sure EEG Files tab is active
    expect(screen.getByRole("tab", { name: /EEG Files/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    // Check for file selection message
    await waitFor(() => {
      expect(
        screen.getByText(
          /Please select a file from the sidebar to start a DDA analysis/i
        )
      ).toBeInTheDocument();
    });
  });
});
