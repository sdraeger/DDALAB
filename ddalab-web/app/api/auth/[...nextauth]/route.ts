import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { DEFAULT_USER_PREFERENCES } from "@/contexts/settings-context";
import { getEnvVar } from "@/lib/utils/env";
import { apiRequest } from "@/lib/utils/request";

const API_URL = getEnvVar("NEXT_PUBLIC_API_URL");
const SESSION_EXPIRATION = parseInt(getEnvVar("SESSION_EXPIRATION"));

declare module "next-auth" {
  interface User {
    accessToken?: string;
    refreshToken?: string;
    id: string;
    name?: string | null;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }

  interface Session {
    accessToken?: string;
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      preferences?: {
        eegZoomFactor?: number;
        theme?: "light" | "dark" | "system";
      };
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    exp?: number;
    id?: string;
    name?: string | null;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        console.log("Authorizing user:", credentials);
        const url = `${API_URL}/api/auth/token`;
        console.log("Fetching token from:", url);

        if (!credentials?.username || !credentials?.password) {
          throw new Error("Missing credentials");
        }

        try {
          const res = await apiRequest({
            url,
            method: "POST",
            contentType: "application/x-www-form-urlencoded",
            body: new URLSearchParams({
              username: credentials.username,
              password: credentials.password,
              grant_type: "password",
            }),
          });

          const data = await res.json();
          console.log("Response:", data);

          if (!res.ok || !data.access_token) {
            throw new Error(data.error || "Login failed");
          }

          const user = {
            id: data.user.id.toString(),
            name: data.user.username,
            email: data.user.email,
            firstName: data.user.first_name,
            lastName: data.user.last_name,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
          };

          console.log("Authorize user:", user);
          return user;
        } catch (error) {
          console.error("Authorize error:", error.message);
          throw error;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      console.log("JWT - Initial token:", token);
      console.log("JWT - User:", user);

      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.email = user.email;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.accessToken = user.accessToken;
        token.refreshToken = user.refreshToken;
      }

      // Fetch preferences for token
      if (token.accessToken && (trigger === "signIn" || trigger === "update")) {
        try {
          const res = await apiRequest({
            url: `${API_URL}/api/user-preferences`,
            token: token.accessToken,
            method: "GET",
            contentType: "application/json",
          });

          if (!res.ok) throw new Error("Failed to fetch preferences");

          const data = await res.json();
          console.log("JWT - Preferences data:", data);

          token.theme = data.theme ?? DEFAULT_USER_PREFERENCES.theme;
          token.eegZoomFactor =
            data.eeg_zoom_factor ?? DEFAULT_USER_PREFERENCES.eegZoomFactor;
          const sessionExpirationMs = SESSION_EXPIRATION * 60 * 1000;
          token.exp = Math.floor((Date.now() + sessionExpirationMs) / 1000);

          console.log("JWT - Preferences fetched:", {
            exp: token.exp,
            theme: token.theme,
            eegZoomFactor: token.eegZoomFactor,
          });
        } catch (error) {
          console.error("JWT - Error fetching preferences:", error);
        }
      }

      const now = Math.floor(Date.now() / 1000);
      if (token.exp && token.exp < now) {
        console.log("JWT - Token expired:", token);
        throw new Error("Token expired");
      }

      if (Date.now() < (token.exp as number)) {
        return token;
      }

      // Refresh token
      return await refreshAccessToken(token);
    },
    async session({ session, token }) {
      if (token) {
        session.user = {
          id: token.id as string,
          name: token.name ?? null,
          email: token.email ?? null,
          firstName: token.firstName ?? null,
          lastName: token.lastName ?? null,
          preferences: {
            theme: token.theme as "light" | "dark" | "system",
            eegZoomFactor: token.eegZoomFactor as number,
          },
        };
        session.accessToken = token.accessToken;

        console.log("Session:", session);
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
};

async function refreshAccessToken(token: any) {
  try {
    const response = await apiRequest({
      url: `${API_URL}/api/auth/refresh-token`,
      method: "POST",
      body: { refresh_token: token.refreshToken },
      contentType: "application/json",
    });

    const refreshedTokens = await response.json();

    if (!response.ok) {
      throw refreshedTokens;
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000, // Convert to milliseconds
      refreshToken: token.refreshToken, // Keep the same refresh token
    };
  } catch (error) {
    console.error("Error refreshing access token:", error);
    return {
      ...token,
      error: "RefreshAccessTokenError",
    };
  }
}

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
