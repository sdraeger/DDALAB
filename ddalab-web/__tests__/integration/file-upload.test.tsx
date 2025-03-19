import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "@/contexts/auth-context";
import { server } from "../mocks/server";
import { rest } from "msw";
import { ThemeProvider } from "../mocks/theme-provider-mock";
// Import commented out until component is created
// import { FileUpload } from "@/components/file-upload";

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
}));

// Mock component for testing
const FileUpload = () => (
  <div>
    <label htmlFor="file-input">Drop files here or click to select files</label>
    <input id="file-input" type="file" multiple />
    <button disabled={false}>Upload</button>
  </div>
);

// Setup MSW server
beforeAll(() => {
  server.listen();

  server.use(
    // File upload endpoint
    rest.post(`${API_URL}/api/files/upload`, (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json({
          success: true,
          file: {
            id: "file-123",
            name: "test-file.edf",
            path: "/data/test-file.edf",
            size: 1024,
            type: "application/octet-stream",
            uploadedAt: new Date().toISOString(),
          },
        })
      );
    }),

    // File list endpoint
    rest.get(`${API_URL}/api/files`, (req, res, ctx) => {
      return res(
        ctx.status(200),
        ctx.json([
          {
            id: "file-123",
            name: "test-file.edf",
            path: "/data/test-file.edf",
            size: 1024,
            type: "application/octet-stream",
            uploadedAt: new Date().toISOString(),
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

describe("File Upload Integration Tests", () => {
  test.skip("renders file upload component with dropzone", async () => {
    render(<FileUpload />, { wrapper: AllProviders });

    // Check that file upload component is rendered
    expect(screen.getByText(/Drop files here/i)).toBeInTheDocument();
    expect(screen.getByText(/or click to select files/i)).toBeInTheDocument();
  });

  test.skip("uploads file successfully", async () => {
    render(<FileUpload />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Create a mock file
    const file = new File(["test file content"], "test-file.edf", {
      type: "application/octet-stream",
    });

    // Get the file input
    const fileInput = screen.getByLabelText(/Drop files here/i);

    // Upload the file
    await user.upload(fileInput, file);

    // Check that file is shown in the UI
    expect(screen.getByText("test-file.edf")).toBeInTheDocument();

    // Click upload button
    const uploadButton = screen.getByRole("button", { name: /Upload/i });
    await user.click(uploadButton);

    // Check for success message
    await waitFor(() => {
      expect(
        screen.getByText(/File uploaded successfully/i)
      ).toBeInTheDocument();
    });
  });

  test.skip("shows error message for invalid file type", async () => {
    render(<FileUpload />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Create a mock file with invalid type
    const file = new File(["test file content"], "invalid.txt", {
      type: "text/plain",
    });

    // Get the file input
    const fileInput = screen.getByLabelText(/Drop files here/i);

    // Upload the file
    await user.upload(fileInput, file);

    // Check for error message about invalid file type
    expect(screen.getByText(/Invalid file type/i)).toBeInTheDocument();

    // The upload button should be disabled
    const uploadButton = screen.getByRole("button", { name: /Upload/i });
    expect(uploadButton).toBeDisabled();
  });

  test.skip("handles server error during upload", async () => {
    // Override the server to return an error
    server.use(
      rest.post(`${API_URL}/api/files/upload`, (req, res, ctx) => {
        return res(
          ctx.status(500),
          ctx.json({ message: "Server error during upload" })
        );
      })
    );

    render(<FileUpload />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Create a mock file
    const file = new File(["test file content"], "test-file.edf", {
      type: "application/octet-stream",
    });

    // Get the file input
    const fileInput = screen.getByLabelText(/Drop files here/i);

    // Upload the file
    await user.upload(fileInput, file);

    // Click upload button
    const uploadButton = screen.getByRole("button", { name: /Upload/i });
    await user.click(uploadButton);

    // Check for error message
    await waitFor(() => {
      expect(
        screen.getByText(/Server error during upload/i)
      ).toBeInTheDocument();
    });
  });

  test.skip("shows upload progress indicator", async () => {
    // Create a slow response
    server.use(
      rest.post(`${API_URL}/api/files/upload`, async (req, res, ctx) => {
        // Delay to show progress
        await new Promise((resolve) => setTimeout(resolve, 100));
        return res(
          ctx.status(200),
          ctx.json({
            success: true,
            file: {
              id: "file-123",
              name: "test-file.edf",
              path: "/data/test-file.edf",
              size: 1024,
              type: "application/octet-stream",
              uploadedAt: new Date().toISOString(),
            },
          })
        );
      })
    );

    render(<FileUpload />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Create a mock file
    const file = new File(["test file content"], "test-file.edf", {
      type: "application/octet-stream",
    });

    // Get the file input
    const fileInput = screen.getByLabelText(/Drop files here/i);

    // Upload the file
    await user.upload(fileInput, file);

    // Click upload button
    const uploadButton = screen.getByRole("button", { name: /Upload/i });
    await user.click(uploadButton);

    // Check for progress indicator
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    // Wait for upload to complete
    await waitFor(() => {
      expect(
        screen.getByText(/File uploaded successfully/i)
      ).toBeInTheDocument();
    });
  });

  test.skip("allows multiple file selection", async () => {
    render(<FileUpload />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Create mock files
    const file1 = new File(["test file 1 content"], "test-file1.edf", {
      type: "application/octet-stream",
    });
    const file2 = new File(["test file 2 content"], "test-file2.edf", {
      type: "application/octet-stream",
    });

    // Get the file input
    const fileInput = screen.getByLabelText(/Drop files here/i);

    // Upload multiple files
    await user.upload(fileInput, [file1, file2]);

    // Check that both files are shown in the UI
    expect(screen.getByText("test-file1.edf")).toBeInTheDocument();
    expect(screen.getByText("test-file2.edf")).toBeInTheDocument();

    // Click upload button
    const uploadButton = screen.getByRole("button", { name: /Upload/i });
    await user.click(uploadButton);

    // Check for success message
    await waitFor(() => {
      expect(
        screen.getByText(/Files uploaded successfully/i)
      ).toBeInTheDocument();
    });
  });
});
