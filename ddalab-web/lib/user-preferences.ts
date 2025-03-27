import { DEFAULT_USER_PREFERENCES } from "@/contexts/settings-context";
import { pool } from "@/lib/db/pool";
import { getSession } from "next-auth/react";

export async function getSessionExpiration(req?: any): Promise<number> {
  try {
    const session = req ? await getSession({ req }) : await getSession();
    const token = session?.accessToken; // NextAuth JWT token

    const url = process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/user-preferences`
      : "http://localhost:8001/api/user-preferences";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else if (req?.headers.get("cookie")) {
      headers["cookie"] = req.headers.get("cookie") || "";
    }

    const res = await fetch(url, {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      console.warn(
        "Failed to fetch session expiration, using default:",
        res.status
      );
      return DEFAULT_USER_PREFERENCES.sessionExpiration!;
    }

    const data = await res.json();
    const expiration = Number(data.sessionExpiration);
    if (isNaN(expiration) || expiration <= 0) {
      console.warn(
        "Invalid session expiration value, using default:",
        data.sessionExpiration
      );
      return DEFAULT_USER_PREFERENCES.sessionExpiration!;
    }

    return expiration;
  } catch (error) {
    console.error("Error in getSessionExpiration:", error);
    return DEFAULT_USER_PREFERENCES.sessionExpiration!;
  }
}

/**
 * Update the user's session expiration preference in the database
 * @param userId - The user's ID
 * @param expirationSeconds - New session expiration in seconds
 * @returns Promise<boolean> - True if updated successfully, false otherwise
 */
export async function updateSessionExpiration(
  userId: string,
  expirationSeconds: number
): Promise<boolean> {
  try {
    const query = `
      INSERT INTO user_preferences (user_id, session_expiration)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET session_expiration = $2
      RETURNING user_id
    `;
    const result = await pool.query(query, [userId, expirationSeconds]);

    if (result.rowCount === 0) {
      console.warn(`Failed to update session expiration for user ${userId}`);
      return false;
    }

    console.log(
      `Updated session expiration for user ${userId} to ${expirationSeconds} seconds`
    );
    return true;
  } catch (error) {
    console.error("Error updating session expiration:", error);
    return false;
  }
}
