import React from "react";
import { render, waitFor, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "@/contexts/auth-context";
import { server } from "../mocks/server";
import { rest } from "msw";
import { ThemeProvider } from "../mocks/theme-provider-mock";
import { EEGDashboard } from "@/components/eeg-dashboard";

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
jest.mock("@/lib/auth", () => ({
  isAuthenticated: jest.fn().mockReturnValue(true),
  getCurrentUser: jest.fn().mockReturnValue({
    id: "1",
    username: "testuser",
    name: "Test User",
  }),
  loginUser: jest.fn(),
  logoutUser: jest.fn(),
}));

// Define EEG data types
interface EEGDataPoint {
  time: number;
  value: number;
}

interface EEGData {
  data: Record<string, EEGDataPoint[]>;
  channels: string[];
  sampleRate: number;
  duration: number;
}

// Generate random EEG data
const generateEEGData = (channels = 4, samples = 1000): EEGData => {
  const data: Record<string, EEGDataPoint[]> = {};
  const channelNames = [
    "Channel 1",
    "Channel 2",
    "Channel 3",
    "Channel 4",
  ].slice(0, channels);

  channelNames.forEach((channel) => {
    data[channel] = Array(samples)
      .fill(0)
      .map((_, i) => ({
        time: i,
        value: Math.sin(i / 50) * 50 + Math.random() * 10,
      }));
  });

  return {
    data,
    channels: channelNames,
    sampleRate: 250,
    duration: samples / 250,
  };
};

// Setup API mocks
beforeAll(() => {
  server.listen();

  server.use(
    // EEG Data endpoint
    rest.get(`${API_URL}/api/eeg/data`, (req, res, ctx) => {
      return res(ctx.status(200), ctx.json(generateEEGData()));
    }),

    // EEG File list endpoint
    rest.get(`${API_URL}/api/eeg/files`, (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json([
          { id: "1", name: "test1.edf", path: "/data/test1.edf" },
          { id: "2", name: "test2.edf", path: "/data/test2.edf" },
          { id: "3", name: "test3.edf", path: "/data/test3.edf" },
        ])
      );
    }),

    // EEG File by ID endpoint
    rest.get(`${API_URL}/api/eeg/files/:id`, (req, res, ctx) => {
      const { id } = req.params;
      return res(
        ctx.status(200),
        ctx.json({
          id,
          name: `test${id}.edf`,
          path: `/data/test${id}.edf`,
          channels: ["Channel 1", "Channel 2", "Channel 3", "Channel 4"],
          sampleRate: 250,
          duration: 10,
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
  data?: EEGDataPoint[];
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

describe("EEG Visualization Integration Test", () => {
  test.skip("renders EEG dashboard with file selector and chart", async () => {
    render(<EEGDashboard />, { wrapper: AllProviders });

    // Check that file selector is rendered
    await waitFor(() => {
      expect(screen.getByText(/Select EEG File/i)).toBeInTheDocument();
    });

    // Check for channel selector
    expect(screen.getByText(/Channel/i)).toBeInTheDocument();
  });

  test.skip("can select EEG file and change channel", async () => {
    render(<EEGDashboard />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Wait for the file selector to load files
    await waitFor(() => {
      expect(screen.getByText(/test1.edf/i)).toBeInTheDocument();
    });

    // Select a file
    await user.click(screen.getByText(/test1.edf/i));

    // Check that the file is selected
    await waitFor(() => {
      expect(screen.getByText(/Channel 1/i)).toBeInTheDocument();
    });

    // Change channel
    const channelSelect = screen.getByLabelText(/Channel/i);
    await user.click(channelSelect);
    await user.click(screen.getByText(/Channel 2/i));

    // Check that the channel changed
    await waitFor(() => {
      expect(screen.getByLabelText(/Channel/i)).toHaveValue("Channel 2");
    });
  });

  test.skip("handles API errors when loading EEG data", async () => {
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
      expect(screen.getByText(/Error loading EEG data/i)).toBeInTheDocument();
    });
  });

  test.skip("displays loading state while fetching data", async () => {
    render(<EEGDashboard />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Wait for the file selector to load
    await waitFor(() => {
      expect(screen.getByText(/test1.edf/i)).toBeInTheDocument();
    });

    // Select a file which should trigger loading state
    await user.click(screen.getByText(/test1.edf/i));

    // Check for loading indicator
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();

    // Wait for data to load
    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });
  });

  test.skip("can toggle between time and frequency domain", async () => {
    render(<EEGDashboard />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Wait for controls to be visible
    await waitFor(() => {
      expect(screen.getByText(/Display Mode/i)).toBeInTheDocument();
    });

    // Default should be time domain
    expect(screen.getByLabelText(/Display Mode/i)).toHaveValue("time");

    // Toggle to frequency domain
    await user.click(screen.getByLabelText(/Display Mode/i));
    await user.click(screen.getByText(/Frequency/i));

    // Check that display mode changed
    await waitFor(() => {
      expect(screen.getByLabelText(/Display Mode/i)).toHaveValue("frequency");
    });
  });
});
