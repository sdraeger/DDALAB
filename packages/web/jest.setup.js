import "@testing-library/jest-dom";

// Mock Next.js router
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: () => "/test-path",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock Next.js image
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} />;
  },
}));

// Mock NextAuth
jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "1",
        name: "Test User",
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
        preferences: {
          theme: "light",
          eegZoomFactor: 1.0,
        },
      },
      accessToken: "test-token",
    },
    status: "authenticated",
  }),
  signIn: jest.fn(),
  signOut: jest.fn(),
  getSession: jest.fn(),
}));

// Mock Apollo Client
jest.mock("@apollo/client", () => ({
  ...jest.requireActual("@apollo/client"),
  useQuery: () => ({
    data: null,
    loading: false,
    error: null,
    refetch: jest.fn(),
  }),
  useMutation: () => [
    jest.fn().mockResolvedValue({ data: {} }),
    { loading: false, error: null },
  ],
  ApolloProvider: ({ children }) => children,
}));

// Mock process.env
process.env.NODE_ENV = "test";
process.env.API_URL = "http://localhost:8001";
process.env.NEXT_PUBLIC_API_URL = "http://localhost:8001";
process.env.SESSION_EXPIRATION = "30";

// Mock window.location (only in jsdom environment)
if (typeof window !== "undefined") {
  Object.defineProperty(window, "location", {
    value: {
      href: "http://localhost:3000",
      origin: "http://localhost:3000",
      pathname: "/",
      search: "",
      hash: "",
    },
    writable: true,
  });
}

// Suppress console warnings during tests
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};
