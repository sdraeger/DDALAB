import { rest } from "msw";
import { config } from "@/lib/config";

// Base URL for test requests
const API_URL = "http://localhost";

// Mock successful login response
const mockUser = {
  id: "1",
  username: "testuser",
  name: "Test User",
  email: "test@example.com",
  role: "user",
};

// Mock JWT token for authentication
const mockToken = "mock.jwt.token";

export const handlers = [
  // Handle login requests
  rest.post(`${API_URL}/auth/login`, (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        user: mockUser,
        token: mockToken,
      })
    );
  }),

  // Handle logout requests
  rest.post(`${API_URL}/auth/logout`, (req, res, ctx) => {
    return res(
      ctx.status(200),
      ctx.json({
        success: true,
      })
    );
  }),

  // Handle user registration
  rest.post(`${API_URL}/auth/register`, (req, res, ctx) => {
    return res(
      ctx.status(201),
      ctx.json({
        user: mockUser,
        token: mockToken,
      })
    );
  }),

  // Handle getting current user
  rest.get(`${API_URL}/users/me`, (req, res, ctx) => {
    return res(ctx.status(200), ctx.json(mockUser));
  }),

  // Handle EEG data fetching
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
];
