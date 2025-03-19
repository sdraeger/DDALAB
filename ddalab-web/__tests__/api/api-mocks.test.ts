import { rest } from "msw";
import { server } from "../mocks/server";

// This test verifies that our MSW setup works correctly
describe("API Mocking", () => {
  // Start MSW server before tests
  beforeAll(() => server.listen());

  // Reset handlers after each test
  afterEach(() => server.resetHandlers());

  // Close server after all tests
  afterAll(() => server.close());

  // Set a base URL for our tests
  const API_URL = "http://localhost";

  test("mocks the login endpoint", async () => {
    // Add a specific handler for this test
    server.use(
      rest.post(`${API_URL}/auth/login`, (req, res, ctx) => {
        return res(
          ctx.status(200),
          ctx.json({
            user: {
              id: "1",
              username: "testuser",
              name: "Test User",
              email: "test@example.com",
              role: "user",
            },
            token: "mock.jwt.token",
          })
        );
      })
    );

    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "testuser",
        password: "password123",
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty("user");
    expect(data).toHaveProperty("token");
    expect(data.user.username).toBe("testuser");
  });

  test("mocks failed login", async () => {
    // Override handler for this test
    server.use(
      rest.post(`${API_URL}/auth/login`, (req, res, ctx) => {
        return res(
          ctx.status(401),
          ctx.json({ message: "Invalid credentials" })
        );
      })
    );

    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "testuser",
        password: "wrongpassword",
      }),
    });

    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toHaveProperty("message");
    expect(data.message).toBe("Invalid credentials");
  });
});
