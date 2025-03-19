import { NextRequest, NextResponse } from "next/server";
import userAuth from "@/lib/db/user-auth";

// Define the User interface
interface User {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  is_admin: boolean;
}

// Helper to check if user is admin
async function isAdminUser(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;

  const token = authHeader.split(" ")[1];
  if (!token) return false;

  try {
    const user = (await userAuth.validateToken(token)) as User | null;
    return user?.is_admin === true;
  } catch (error) {
    return false;
  }
}

/**
 * POST /api/auth/invite
 * Endpoint to generate invite codes (admin only)
 */
export async function POST(request: NextRequest) {
  try {
    // Check if user is admin
    if (!(await isAdminUser(request))) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins can generate invite codes." },
        { status: 403 }
      );
    }

    // Extract options from request body
    const { email, maxUses = 1, expiresInDays } = await request.json();

    // Calculate expiration date if provided
    let expiresAt = undefined;
    if (expiresInDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }

    // Generate the invite code
    const inviteCode = await userAuth.createInviteCode({
      email,
      maxUses,
      expiresAt,
    });

    return NextResponse.json({
      message: "Invite code generated successfully",
      inviteCode,
    });
  } catch (error: any) {
    console.error("Invite code generation error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate invite code" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/invite
 * Endpoint to list all invite codes (admin only)
 */
export async function GET(request: NextRequest) {
  try {
    // Check if user is admin
    if (!(await isAdminUser(request))) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins can view invite codes." },
        { status: 403 }
      );
    }

    // Get active only parameter from query string
    const url = new URL(request.url);
    const activeOnly = url.searchParams.get("active") === "true";

    // Connect to the database
    const { Pool } = require("pg");
    const pool = new Pool(); // Uses env vars for connection

    try {
      // Query to get invite codes
      let query = `
        SELECT id, code, email, created_by, max_uses, uses, 
               expires_at, is_active, created_at, updated_at
        FROM invite_codes
      `;

      // Filter by active status if specified
      if (activeOnly) {
        query += ` WHERE is_active = true AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`;
      }

      // Sort by creation date
      query += ` ORDER BY created_at DESC`;

      const result = await pool.query(query);

      return NextResponse.json({
        inviteCodes: result.rows,
        count: result.rowCount,
      });
    } finally {
      // Make sure to release the connection
      pool.end();
    }
  } catch (error: any) {
    console.error("Listing invite codes error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list invite codes" },
      { status: 500 }
    );
  }
}
