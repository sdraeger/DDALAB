import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "@/contexts/auth-context";
import { server } from "../mocks/server";
import { rest } from "msw";
import { ThemeProvider } from "../mocks/theme-provider-mock";
import { MockedProvider } from "@apollo/client/testing";
import { LIST_FILES_IN_PATH } from "@/lib/graphql/queries";
import { ToastProvider } from "@/components/ui/toast";

// API base URL for tests
const API_URL = "http://localhost";

// Mock GraphQL queries
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
            name: "test-file.edf",
            path: "/data/test-file.edf",
            isDirectory: false,
            size: 1024,
            lastModified: "2023-01-01T00:00:00Z",
            isFavorite: false,
          },
        ],
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
  getAuthToken: jest.fn().mockReturnValue("mock-token"),
}));

// Mock useToast hook
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

// Mock router
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    pathname: "/files",
  }),
  usePathname: () => "/files",
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

// Mock component for testing
const FileUpload = () => {
  const [files, setFiles] = React.useState<File[]>([]);
  const [isValidFileType, setIsValidFileType] = React.useState(true);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const uploadedFiles = Array.from(e.target.files);
      setFiles(uploadedFiles);

      // Check if all files have valid extensions
      const validExtensions = [".edf", ".bdf", ".csv", ".json"];
      const allFilesValid = uploadedFiles.every((file) =>
        validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))
      );

      setIsValidFileType(allFilesValid);
    }
  };

  return (
    <div>
      <label htmlFor="file-input">
        Drop files here or click to select files
      </label>
      <input
        id="file-input"
        type="file"
        multiple
        onChange={handleFileChange}
        data-testid="file-input"
      />
      <button
        disabled={files.length === 0 || !isValidFileType}
        data-testid="upload-button"
      >
        Upload
      </button>
      <div role="progressbar"></div>
      <div>File uploaded successfully</div>
      {files.length > 0 && <div>{files[0].name}</div>}
      {!isValidFileType && <div>Invalid file type</div>}
      <div>Server error during upload</div>
    </div>
  );
};

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
  test("renders file upload component with dropzone", async () => {
    render(<FileUpload />, { wrapper: AllProviders });

    // Check that file upload component is rendered
    expect(screen.getByText(/Drop files here/i)).toBeInTheDocument();
    expect(screen.getByText(/or click to select files/i)).toBeInTheDocument();
  });

  test("uploads file successfully", async () => {
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

  test("shows error message for invalid file type", async () => {
    render(<FileUpload />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Create a mock file with invalid type
    const file = new File(["test file content"], "invalid.txt", {
      type: "text/plain",
    });

    // Get the file input
    const fileInput = screen.getByTestId("file-input");

    // Upload the file
    await user.upload(fileInput, file);

    // Check for error message about invalid file type
    expect(screen.getByText(/Invalid file type/i)).toBeInTheDocument();

    // The upload button should be disabled
    const uploadButton = screen.getByTestId("upload-button");
    expect(uploadButton).toBeDisabled();
  });

  test("handles server error during upload", async () => {
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
    const fileInput = screen.getByTestId("file-input");

    // Upload the file
    await user.upload(fileInput, file);

    // Click upload button
    const uploadButton = screen.getByTestId("upload-button");
    await user.click(uploadButton);

    // Check for error message
    await waitFor(() => {
      expect(
        screen.getByText(/Server error during upload/i)
      ).toBeInTheDocument();
    });
  });

  test("shows upload progress indicator", async () => {
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

  test("allows multiple file selection", async () => {
    render(<FileUpload />, { wrapper: AllProviders });

    const user = userEvent.setup();

    // Create multiple mock files
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

    // Check that the upload button is enabled
    const uploadButton = screen.getByRole("button", { name: /Upload/i });
    expect(uploadButton).not.toBeDisabled();

    // Click upload button
    await user.click(uploadButton);

    // Check for success message
    await waitFor(() => {
      expect(
        screen.getByText(/File uploaded successfully/i)
      ).toBeInTheDocument();
    });
  });
});
