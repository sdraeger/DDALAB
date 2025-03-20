import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, updateUserPreferences } from "@/lib/auth";
import type { UserPreferences } from "@/lib/auth";

// Default values for user preferences
const DEFAULT_PREFERENCES: Required<
  Pick<UserPreferences, "eegZoomFactor" | "theme">
> = {
  eegZoomFactor: 0.05, // Default 5% zoom factor
  theme: "system", // Default theme follows system preference
};

// GET endpoint to retrieve user preferences
export async function GET(req: NextRequest) {
  try {
    // Get current user
    const user = getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      );
    }

    // Return current preferences or defaults if not set
    return NextResponse.json({
      preferences: {
        ...DEFAULT_PREFERENCES,
        ...user.preferences,
      },
    });
  } catch (error) {
    console.error("Error retrieving user preferences:", error);
    return NextResponse.json(
      { error: "Failed to retrieve preferences" },
      { status: 500 }
    );
  }
}

// POST endpoint to update user preferences
export async function POST(req: NextRequest) {
  try {
    // Get current user
    const user = getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      );
    }

    // Get preferences from request body
    const data = await req.json();
    const newPreferences: UserPreferences = data.preferences || {};

    // Validate zoom factor (if provided)
    if (newPreferences.eegZoomFactor !== undefined) {
      if (
        typeof newPreferences.eegZoomFactor !== "number" ||
        newPreferences.eegZoomFactor < 0.01 ||
        newPreferences.eegZoomFactor > 0.2
      ) {
        return NextResponse.json(
          {
            error: "Invalid zoom factor. Must be a number between 0.01 and 0.2",
          },
          { status: 400 }
        );
      }
    }

    // Update preferences
    const success = await updateUserPreferences(newPreferences);
    if (!success) {
      return NextResponse.json(
        { error: "Failed to update preferences" },
        { status: 500 }
      );
    }

    // Get updated user
    const updatedUser = getCurrentUser();

    // Return updated preferences
    return NextResponse.json({
      preferences: updatedUser?.preferences || {},
    });
  } catch (error) {
    console.error("Error updating user preferences:", error);
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 }
    );
  }
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
