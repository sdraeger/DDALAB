import { NextRequest, NextResponse } from "next/server";
import { UserPreferences } from "@/contexts/settings-context";
import { getSession } from "next-auth/react";
import { pool } from "@/lib/db/pool";
import logger from "@/lib/utils/logger";

// Default values for user preferences
const DEFAULT_PREFERENCES: Required<UserPreferences> = {
  eegZoomFactor: 0.05, // Default 5% zoom factor
  theme: "system", // Default theme follows system preference
  sessionExpiration: 30 * 60, // Default 30 minutes
};

// GET endpoint to retrieve user preferences
export async function GET(req: NextRequest) {
  const session = await getSession({ req });
  const userId = session?.user?.id;
  const token = session?.accessToken;

  logger.info("userId:", userId);
  logger.info("token:", token);

  if (!userId || !token) {
    return NextResponse.json(
      { sessionExpiration: DEFAULT_PREFERENCES.sessionExpiration },
      { status: 200 }
    );
  }

  try {
    // Proxy to FastAPI if needed, or use local DB
    const res = await fetch("/api/user-preferences", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    console.log("Response:", res);
    if (!res.ok) throw new Error(`FastAPI error: ${res.status}`);
    const data = await res.json();
    return NextResponse.json(
      { sessionExpiration: data.sessionExpiration },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching from FastAPI:", error);
    // Fallback to local DB
    const query = `
      SELECT session_expiration
      FROM user_preferences
      WHERE user_id = $1
    `;
    const result = await pool.query(query, [userId]);
    const sessionExpiration =
      result.rows.length > 0 && result.rows[0].session_expiration
        ? result.rows[0].session_expiration
        : DEFAULT_PREFERENCES.sessionExpiration;
    return NextResponse.json({ sessionExpiration }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession({ req });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionExpiration } = await req.json();
    if (typeof sessionExpiration !== "number") {
      return NextResponse.json(
        { error: "Invalid sessionExpiration" },
        { status: 400 }
      );
    }

    const userId = session.user.id;
    const query = `
      INSERT INTO user_preferences (user_id, session_expiration)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET session_expiration = $2
      RETURNING user_id
    `;
    const result = await pool.query(query, [userId, sessionExpiration]);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Failed to update" }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error updating session expiration:", error);
    return NextResponse.json(
      { error: "Failed to update session expiration" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.split(" ")[1];
  const body = await request.json();

  const res = await fetch("http://localhost:8001/api/user-preferences", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: res.status }
    );
  }
  return NextResponse.json({ success: true });
}

// DELETE endpoint to reset a specific preference or all preferences
export async function DELETE(req: NextRequest) {
  try {
    // Get current user
    const user = getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      );
    }

    // Get preference key from URL
    const { searchParams } = new URL(req.url);
    const preferenceKey = searchParams.get("key");

    // If key provided, reset only that preference to default
    if (preferenceKey && preferenceKey in DEFAULT_PREFERENCES) {
      const resetPreferences: UserPreferences = {};
      resetPreferences[preferenceKey as keyof UserPreferences] =
        DEFAULT_PREFERENCES[preferenceKey as keyof typeof DEFAULT_PREFERENCES];

      const success = await updateUserPreferences(resetPreferences);
      if (!success) {
        return NextResponse.json(
          { error: "Failed to reset preference" },
          { status: 500 }
        );
      }
    }
    // Otherwise reset all preferences to defaults
    else if (!preferenceKey) {
      const success = await updateUserPreferences(DEFAULT_PREFERENCES);
      if (!success) {
        return NextResponse.json(
          { error: "Failed to reset preferences" },
          { status: 500 }
        );
      }
    }
    // Handle non-existent preference key
    else {
      return NextResponse.json(
        { error: "Invalid preference key" },
        { status: 400 }
      );
    }

    // Return the updated preferences
    const updatedUser = getCurrentUser();
    return NextResponse.json({
      preferences: updatedUser?.preferences || {},
    });
  } catch (error) {
    console.error("Error resetting user preferences:", error);
    return NextResponse.json(
      { error: "Failed to reset preferences" },
      { status: 500 }
    );
  }
}
