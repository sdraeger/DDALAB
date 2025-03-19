import { NextRequest, NextResponse } from "next/server";
import userAuth from "@/lib/db/user-auth";

// Define interfaces for typed data
interface User {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  is_admin: boolean;
}

interface TokenResult {
  id: number;
  token: string;
  description: string;
  expires_at: Date;
  created_at: Date;
}

/**
 * POST /api/auth/backend-token
 * Endpoint to authenticate a user and generate an access token.
 * This is actually a local endpoint for authentication that doesn't
 * proxy to any external service, avoiding infinite redirects.
 */
export async function POST(request: NextRequest) {
  try {
    console.log("Received direct auth request to backend-token");

    // Parse credentials from request body (handle both JSON and form-urlencoded)
    let username: string = "";
    let password: string = "";

    const contentType = request.headers.get("content-type") || "";

    // Handle different content types
    if (contentType.includes("application/json")) {
      // Handle JSON request
      const body = await request.json();
      username = body.username;
      password = body.password;
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      // Try to parse form-urlencoded request
      const text = await request.text();
      const params = new URLSearchParams(text);
      username = params.get("username") || "";
      password = params.get("password") || "";
    }

    if (!username || !password) {
      return NextResponse.json(
        { error: "Missing username or password" },
        { status: 400 }
      );
    }

    // Directly authenticate the user
    const user = (await userAuth.authenticateUser(username, password)) as User;

    if (!user) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Generate an API token
    const tokenResult = (await userAuth.createUserToken(
      user.id
    )) as TokenResult;

    // Format the response to match expected OAuth-like format
    return NextResponse.json({
      access_token: tokenResult.token,
      token_type: "bearer",
      expires_at: tokenResult.expires_at,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name:
          `${user.first_name || ""} ${user.last_name || ""}`.trim() ||
          user.username,
        isAdmin: user.is_admin,
      },
    });
  } catch (error) {
    console.error("Auth error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Authentication failed",
      },
      { status: 500 }
    );
  }
}
