import { getSession } from "next-auth/react";

export async function getUnifiedSessionToken(): Promise<string | null> {
  // Check if we're in local mode
  if (typeof window !== "undefined" && (window as any).__useSessionOverride) {
    const localSession = (window as any).__useSessionOverride();
    return localSession?.data?.accessToken || null;
  }

  // Fall back to NextAuth session
  try {
    const session = await getSession();
    return session?.accessToken || null;
  } catch (error) {
    console.warn("Failed to get session token:", error);
    return null;
  }
}
