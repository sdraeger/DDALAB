import { NextRequest, NextResponse } from "next/server";
import userAuth from "@/lib/db/user-auth";

// Define interfaces for the returned objects
interface User {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  created_at: string;
}

interface TokenResult {
  id: number;
  token: string;
  description: string;
  expires_at: Date;
  created_at: Date;
}

interface InviteCode {
  id: number;
  code: string;
  email?: string;
  max_uses: number;
  uses: number;
  expires_at?: Date;
  is_active: boolean;
}

interface InviteCodeValidation {
  valid: boolean;
  message?: string;
  email?: string;
}

/**
 * POST /api/auth/register
 * Endpoint to register a new user with an invite code
 */
export async function POST(request: NextRequest) {
  try {
    // Extract user data and invite code from request body
    const body = await request.json();
    const { username, password, email, firstName, lastName, inviteCode } = body;

    console.log("Registration request received:", {
      username,
      email,
      firstName,
      lastName,
      inviteCode,
      hasPassword: !!password,
    });

    // Validate required fields
    if (!username || !password || !email || !inviteCode) {
      return NextResponse.json(
        { error: "Username, password, email, and invite code are required" },
        { status: 400 }
      );
    }

    // Validate invite code
    const validCodeResult = (await userAuth.validateInviteCode(
      inviteCode,
      email
    )) as InviteCodeValidation;

    if (!validCodeResult || !validCodeResult.valid) {
      return NextResponse.json(
        {
          error:
            validCodeResult?.message ||
            "Invalid, expired, or already used invite code",
        },
        { status: 400 }
      );
    }

    // Register the new user with the invite code
    try {
      const newUser = (await userAuth.registerWithInviteCode(
        {
          username,
          password,
          email,
          firstName,
          lastName,
        },
        inviteCode
      )) as User;

      // Generate a token for immediate login
      const tokenResult = (await userAuth.createUserToken(
        newUser.id,
        "Registration token",
        7 // 7 days expiration
      )) as TokenResult;

      // Return the user and token data
      return NextResponse.json({
        message: "Registration successful",
        user: newUser,
        token: tokenResult.token,
        expires_at: tokenResult.expires_at,
      });
    } catch (dbError: any) {
      // Handle duplicate username/email errors
      if (dbError.code === "23505") {
        // PostgreSQL unique violation error code
        if (dbError.detail?.includes("username")) {
          return NextResponse.json(
            { error: "Username already exists" },
            { status: 409 }
          );
        } else if (dbError.detail?.includes("email")) {
          return NextResponse.json(
            { error: "Email already exists" },
            { status: 409 }
          );
        }
      }

      throw dbError;
    }
  } catch (error: any) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: error.message || "Registration failed" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/register/validate-code
 * Endpoint to validate an invite code
 */
export async function GET(request: NextRequest) {
  try {
    // Get the invite code from URL query parameters
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const email = url.searchParams.get("email");

    if (!code) {
      return NextResponse.json(
        { error: "Invite code is required" },
        { status: 400 }
      );
    }

    // Validate the invite code
    const validCodeResult = (await userAuth.validateInviteCode(
      code,
      email || undefined
    )) as InviteCodeValidation;

    if (!validCodeResult || !validCodeResult.valid) {
      return NextResponse.json(
        {
          valid: false,
          message: validCodeResult?.message || "Invalid or expired invite code",
        },
        { status: 200 }
      );
    }

    // Return the validation result
    return NextResponse.json(
      {
        valid: true,
        message: validCodeResult.message || "Invite code is valid",
        email: validCodeResult.email || null,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Code validation error:", error);
    return NextResponse.json(
      { error: "Failed to validate invite code" },
      { status: 500 }
    );
  }
}
