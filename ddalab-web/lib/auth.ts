import { config } from "./config";
import { apolloClient } from "./apollo-client";

export interface User {
  id: string;
  username: string;
  name: string;
  email?: string;
  role?: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: string;
  user?: User;
  expiresIn?: number;
}

export interface RegisterCredentials {
  username: string;
  password: string;
  email: string;
  firstName?: string;
  lastName?: string;
  inviteCode: string;
}

// Function to login user
export async function loginUser(
  credentials: LoginCredentials
): Promise<AuthResponse> {
  try {
    // Use our local API route instead of directly calling the server
    console.log("Login user", JSON.stringify(credentials));

    // Convert credentials to URL-encoded form data
    const formData = new URLSearchParams({
      username: credentials.username,
      password: credentials.password,
    }).toString();

    const response = await fetch("/api/auth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData,
    });

    if (!response.ok) {
      console.log("Login failed", response.status, response.statusText);
      const errorData = await response.json();
      throw new Error(errorData.error || errorData.detail || "Login failed");
    }

    const data = await response.json();
    console.log("Login response:", data);

    // Extract token and user from response
    const token = data.access_token;

    // Use the returned user data if available, otherwise create a basic user object
    const user: User = data.user || {
      id: "1", // Placeholder
      username: credentials.username,
      name: credentials.username, // Use username as name for now
    };

    // Calculate and store token expiration time
    // Default to 30 minutes if expiresIn not specified from server
    const expiresInSeconds = data.expires_in || 30 * 60;
    const expirationTime = Date.now() + expiresInSeconds * 1000;

    // Store token, expiration time and user in localStorage
    localStorage.setItem(config.auth.tokenKey, token);
    localStorage.setItem(
      config.auth.tokenExpirationKey,
      expirationTime.toString()
    );
    localStorage.setItem(config.auth.userKey, JSON.stringify(user));

    return {
      accessToken: token,
      tokenType: data.token_type || "bearer",
      user,
      expiresIn: expiresInSeconds,
    };
  } catch (error) {
    console.error("Login error:", error);
    throw error;
  }
}

// Function to logout user
export function logoutUser(): void {
  localStorage.removeItem(config.auth.tokenKey);
  localStorage.removeItem(config.auth.tokenExpirationKey);
  localStorage.removeItem(config.auth.userKey);

  // Reset Apollo Client store to clear cached data
  apolloClient.resetStore();
}

// Function to check if token is expired
export function isTokenExpired(): boolean {
  if (typeof window === "undefined") return true;

  const expirationTime = localStorage.getItem(config.auth.tokenExpirationKey);
  if (!expirationTime) return true;

  // Compare current time with expiration time
  // Add a 30-second buffer to account for network latency
  return Date.now() > parseInt(expirationTime) - 30000;
}

// Function to check if user is logged in with valid token
export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;

  // Check if token exists
  const token = localStorage.getItem(config.auth.tokenKey);
  if (!token) return false;

  // Check if token is not expired
  return !isTokenExpired();
}

// Function to get current user
export function getCurrentUser(): User | null {
  if (typeof window === "undefined") return null;

  // If token is expired, don't return user
  if (isTokenExpired()) {
    logoutUser(); // Clean up storage if token expired
    return null;
  }

  const userJson = localStorage.getItem(config.auth.userKey);
  if (!userJson) return null;

  try {
    return JSON.parse(userJson);
  } catch (error) {
    console.error("Error parsing user data:", error);
    return null;
  }
}

// Function to get auth token if valid
export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;

  // Return null if token is expired
  if (isTokenExpired()) {
    logoutUser(); // Clean up storage if token expired
    return null;
  }

  return localStorage.getItem(config.auth.tokenKey);
}

// Function to get token expiration time in milliseconds
export function getTokenExpirationTime(): number | null {
  if (typeof window === "undefined") return null;

  const expirationTime = localStorage.getItem(config.auth.tokenExpirationKey);
  return expirationTime ? parseInt(expirationTime) : null;
}

// Function to get remaining token time in seconds
export function getTokenRemainingTime(): number | null {
  const expirationTime = getTokenExpirationTime();
  if (!expirationTime) return null;

  const remainingMs = expirationTime - Date.now();
  return remainingMs > 0 ? Math.floor(remainingMs / 1000) : 0;
}

// Function to register a new user
export async function registerUser(
  credentials: RegisterCredentials
): Promise<AuthResponse> {
  try {
    console.log("Register user", JSON.stringify(credentials));

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(credentials),
    });

    if (!response.ok) {
      console.log("Registration failed", response.status, response.statusText);
      const errorData = await response.json();
      throw new Error(
        errorData.error || errorData.detail || "Registration failed"
      );
    }

    const data = await response.json();

    // Extract token and user from response
    const token = data.token;
    const user = data.user;

    // Calculate and store token expiration time
    // Default to 30 minutes if expiresIn not specified from server
    const expiresInSeconds = data.expires_in || 30 * 60;
    const expirationTime = Date.now() + expiresInSeconds * 1000;

    // Store token, expiration time and user in localStorage
    localStorage.setItem(config.auth.tokenKey, token);
    localStorage.setItem(
      config.auth.tokenExpirationKey,
      expirationTime.toString()
    );
    localStorage.setItem(config.auth.userKey, JSON.stringify(user));

    return {
      accessToken: token,
      tokenType: "bearer",
      user,
      expiresIn: expiresInSeconds,
    };
  } catch (error) {
    console.error("Registration error:", error);
    throw error;
  }
}

// Function to validate an invite code
export async function validateInviteCode(
  code: string,
  email?: string
): Promise<boolean> {
  try {
    const url = new URL(
      "/api/auth/register/validate-code",
      window.location.origin
    );
    url.searchParams.append("code", code);
    if (email) {
      url.searchParams.append("email", email);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(
        "Error response from validate-code endpoint:",
        response.status
      );
      return false;
    }

    const data = await response.json();
    return data.valid === true;
  } catch (error) {
    console.error("Error validating invite code:", error);
    return false;
  }
}

// Function to validate email format
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Secure fetch that checks token validity before making authenticated requests.
 * This is a wrapper around the native fetch that adds authorization headers
 * and handles token expiration.
 */
export async function secureFetch(
  url: string,
  options: RequestInit = {},
  requiresAuth: boolean = true
): Promise<Response> {
  // For authenticated requests, check token validity
  if (requiresAuth) {
    // Check if token is expired
    if (isTokenExpired()) {
      throw new Error("Authentication token has expired. Please log in again.");
    }

    // Get valid token
    const token = getAuthToken();
    if (!token) {
      throw new Error(
        "No valid authentication token found. Please log in again."
      );
    }

    // Add authorization header
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);

    // Return fetch with auth headers
    return fetch(url, {
      ...options,
      headers,
    });
  }

  // For non-authenticated requests, just pass through
  return fetch(url, options);
}
