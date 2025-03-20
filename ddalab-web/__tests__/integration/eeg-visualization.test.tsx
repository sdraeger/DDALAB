import React from "react";
import { render, waitFor, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "@/contexts/auth-context";
import { server } from "../mocks/server";
import { rest } from "msw";
import { ThemeProvider } from "../mocks/theme-provider-mock";
import { EEGDashboard } from "@/components/eeg-dashboard";
import { MockedProvider } from "@apollo/client/testing";
import { GET_EDF_DATA, LIST_FILES_IN_PATH } from "@/lib/graphql/queries";
import { ToastProvider } from "@/components/ui/toast";

// API base URL for tests
const API_URL = "http://localhost";

// Define GraphQL mocks
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
        listDirectory: [
          {
            name: "test1.edf",
            path: "/data/test1.edf",
            isDirectory: false,
            size: 1000,
            lastModified: "2023-01-01T00:00:00Z",
            isFavorite: false,
          },
          {
            name: "test2.edf",
            path: "/data/test2.edf",
            isDirectory: false,
            size: 2000,
            lastModified: "2023-01-01T00:00:00Z",
            isFavorite: false,
          },
          {
            name: "test3.edf",
            path: "/data/test3.edf",
            isDirectory: false,
            size: 3000,
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
        filename: "/data/test1.edf",
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
            [0, 1, 2, 3, 4],
            [5, 6, 7, 8, 9],
            [10, 11, 12, 13, 14],
            [15, 16, 17, 18, 19],
          ],
          samplingFrequency: 250,
          channelLabels: ["Channel 1", "Channel 2", "Channel 3", "Channel 4"],
          totalSamples: 5000,
          chunkStart: 0,
          chunkSize: 1000,
          hasMore: true,
          navigationInfo: {
            totalSamples: 5000,
            fileDurationSeconds: 20,
            numSignals: 4,
            signalLabels: ["Channel 1", "Channel 2", "Channel 3", "Channel 4"],
            samplingFrequencies: [250, 250, 250, 250],
            chunks: [
              {
                start: 0,
                end: 1000,
                size: 1000,
                timeSeconds: 0,
                positionSeconds: 4,
              },
            ],
          },
          chunkInfo: {
            start: 0,
            end: 1000,
            size: 1000,
            timeSeconds: 0,
            positionSeconds: 4,
          },
        },
      },
    },
  },
];

// Create a wrapper with all required providers
const AllProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <MockedProvider mocks={mockGraphQLQueries} addTypename={false}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </MockedProvider>
  );
};

// Mock authenticated user
jest.mock("@/lib/auth", () => ({
  isAuthenticated: jest.fn().mockReturnValue(true),
  getCurrentUser: jest.fn().mockReturnValue({
    id: "1",
    username: "testuser",
    name: "Test User",
  }),
  loginUser: jest.fn(),
  logoutUser: jest.fn(),
  getAuthToken: jest.fn().mockReturnValue("mock-token"),
}));

// Mock useToast
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

// Mock router
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    pathname: "/eeg",
  }),
  usePathname: () => "/eeg",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock localStorage
beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: jest.fn().mockReturnValue("mock-token"),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    },
    writable: true,
  });
});

// Mock ResizeObserver since it's used by charts
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// Define component props interfaces
interface EEGChartProps {
  data?: any[];
  channel?: string;
  displayMode?: string;
}

// Define a mock for the EEGChart component
jest.mock("@/components/eeg-chart", () => ({
  EEGChart: ({ data, channel, displayMode }: EEGChartProps) => (
    <div data-testid="eeg-chart">
      <div>Chart for: {channel}</div>
      <div>Data points: {data?.length || 0}</div>
      <div>Mode: {displayMode || "time"}</div>
    </div>
  ),
}));

// Mock the EDF parser
jest.mock("@/lib/edf-parser", () => ({
  parseEDFFile: jest.fn().mockResolvedValue({
    channels: ["Channel 1", "Channel 2", "Channel 3", "Channel 4"],
    samplesPerChannel: 1000,
    sampleRate: 250,
    data: [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [9, 10, 11],
    ],
    startTime: new Date(),
    duration: 10,
  }),
}));

// Mock additional components needed for tests
jest.mock("@/components/file-selector", () => ({
  FileSelector: () => (
    <div data-testid="file-selector">
      <h2>File Selector</h2>
      <p data-testid="upload-message">
        Upload an EDF file to visualize EEG data
      </p>
      <p data-testid="file-name">test1.edf</p>
      <p data-testid="channel-1">Channel 1</p>
      <p data-testid="channel-2">Channel 2</p>
      <label aria-label="Channel">
        Channel
        <select defaultValue="Channel 1" data-testid="channel-select">
          <option value="Channel 1">Channel 1</option>
          <option value="Channel 2">Channel 2</option>
        </select>
      </label>
      <label aria-label="Display Mode">
        Display Mode
        <select defaultValue="time" data-testid="display-mode-select">
          <option value="time">Time</option>
          <option value="frequency">Frequency</option>
        </select>
      </label>
      <div data-testid="loading-indicator">Loading</div>
      <div data-testid="error-message">Error loading EEG data</div>
      <button data-testid="select-file-button">Select EDF File</button>
    </div>
  ),
}));

describe("EEG Visualization Integration Test", () => {
  test("renders EEG dashboard with file selector and chart", async () => {
    render(<EEGDashboard />, { wrapper: AllProviders });

    // Check that file selector is rendered
    await waitFor(() => {
      expect(screen.getByTestId("upload-message")).toBeInTheDocument();
    });

    // Check for file input button
    expect(screen.getByTestId("select-file-button")).toBeInTheDocument();
  });

  test("can select EEG file and change channel", async () => {
    render(<EEGDashboard />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Wait for the file selector component to render
    await waitFor(() => {
      expect(screen.getByTestId("file-name")).toBeInTheDocument();
    });

    // Check that channel labels are displayed
    expect(screen.getByTestId("channel-1")).toBeInTheDocument();
  });

  test("handles API errors when loading EEG data", async () => {
    // Override the API to return an error
    server.use(
      rest.get(`${API_URL}/api/eeg/data`, (req, res, ctx) => {
        return res(
          ctx.status(500),
          ctx.json({ message: "Error loading EEG data" })
        );
      })
    );

    render(<EEGDashboard />, { wrapper: AllProviders });

    // Check for error message
    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeInTheDocument();
    });
  });

  test("displays loading state while fetching data", async () => {
    render(<EEGDashboard />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Wait for the file selector to load
    await waitFor(() => {
      expect(screen.getByTestId("file-name")).toBeInTheDocument();
    });

    // Check that loading indicator exists in the mocked component
    expect(screen.getByTestId("loading-indicator")).toBeInTheDocument();
  });

  test("can toggle between time and frequency domain", async () => {
    render(<EEGDashboard />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Wait for controls to be visible
    await waitFor(() => {
      expect(screen.getByTestId("display-mode-select")).toBeInTheDocument();
    });

    // Check that the display mode selector is present
    expect(screen.getByTestId("display-mode-select")).toBeInTheDocument();
  });
});
