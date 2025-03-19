// Mock basic auth module functionality
export const isAuthenticated = jest.fn().mockReturnValue(false);
export const getCurrentUser = jest.fn().mockReturnValue(null);
export const loginUser = jest.fn().mockResolvedValue({
  user: {
    id: "1",
    username: "testuser",
    name: "Test User",
    email: "test@example.com",
    role: "user",
  },
  token: "mock.jwt.token",
});
export const logoutUser = jest.fn();
export const registerUser = jest.fn().mockResolvedValue({
  user: {
    id: "1",
    username: "testuser",
    name: "Test User",
    email: "test@example.com",
    role: "user",
  },
  token: "mock.jwt.token",
});
