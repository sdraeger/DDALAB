import NextAuth, {
  NextAuthOptions,
  DefaultSession,
  DefaultUser,
} from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { DEFAULT_USER_PREFERENCES } from "shared/contexts/SettingsContext";
import { getEnvVar } from "shared/lib/utils/env";
import { get, post } from "shared/lib/utils/request";
import { TokenResponse, UserPreferences } from "shared/types/auth";

// Use relative API paths via shared request utilities.
// This avoids relying on baked NEXT_PUBLIC_* environment variables.

const SESSION_EXPIRATION = parseInt(getEnvVar("SESSION_EXPIRATION"));

declare module "next-auth" {
  export interface Session extends DefaultSession {
    accessToken?: string;
    user?: {
      id: string;
      firstName?: string | null;
      lastName?: string | null;
      preferences?: UserPreferences;
      isLocalMode?: boolean;
      accessToken?: string;
    } & DefaultSession["user"];
  }

  export interface User extends DefaultUser {
    firstName?: string | null;
    lastName?: string | null;
    accessToken?: string;
    refreshToken?: string;
    preferences?: UserPreferences;
    isLocalMode?: boolean;
  }
}

declare module "next-auth/jwt" {
  export interface JWT {
    accessToken?: string;
    exp?: number;
    id?: string;
    name?: string | null;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    preferences?: UserPreferences;
    isLocalMode?: boolean;
  }
}

// Check authentication mode from API
async function checkAuthMode(): Promise<{
  current_user?: any;
  auth_mode: string;
}> {
  try {
    const response = await get<any>(`/api/auth/mode`);
    return response;
  } catch (error) {
    console.error("Failed to check auth mode:", error);
    // Default to multi-user mode on error
    return { auth_mode: "multi-user" };
  }
}

export const authOptions: NextAuthOptions = {
  debug: process.env.NODE_ENV === "development", // Enable debug logs in development only
  logger: {
    error(code, metadata) {
      console.error(`[NextAuth Error] ${code}:`, metadata);
    },
    warn(code) {
      console.warn(`[NextAuth Warning] ${code}`);
    },
    debug(code, metadata) {
      if (process.env.NODE_ENV === "development") {
        console.debug(`[NextAuth Debug] ${code}:`, metadata);
      }
    },
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // Check if we're in local mode
        const authMode = await checkAuthMode();

        if (authMode.auth_mode === "local") {
          // In local mode, auto-login with the default user
          if (authMode.current_user) {
            const user = authMode.current_user;
            return {
              id: user.id.toString(),
              name: user.username,
              email: user.email,
              firstName: user.first_name,
              lastName: user.last_name,
              accessToken: "local-mode-token", // Placeholder token for local mode
              refreshToken: "local-mode-token",
              isLocalMode: true,
            };
          } else {
            throw new Error("Local mode user not available");
          }
        }

        // Multi-user mode - require credentials
        const url = `/api/auth/token`;

        if (!credentials?.username || !credentials?.password) {
          throw new Error("Missing credentials");
        }

        try {
          const res = await post<TokenResponse>(
            url,
            new URLSearchParams({
              username: credentials.username as string,
              password: credentials.password as string,
              grant_type: "password",
            })
          );

          if (!res.access_token) {
            throw new Error("Login failed");
          }

          const user = {
            id: res.user.id.toString(),
            name: res.user.username,
            email: res.user.email,
            firstName: res.user.firstName,
            lastName: res.user.lastName,
            accessToken: res.access_token,
            refreshToken: res.access_token,
            isLocalMode: false,
          };

          return user;
        } catch (error) {
          console.error(
            "Authorize error:",
            error instanceof Error ? error.message : "Unknown error"
          );
          throw error;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.email = user.email;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.accessToken = user.accessToken;
        token.refreshToken = user.refreshToken;
        token.isLocalMode = user.isLocalMode;
      }

      // For local mode, skip preference fetching and token refresh
      if (token.isLocalMode) {
        // Set default preferences for local mode
        token.theme = DEFAULT_USER_PREFERENCES.theme;
        token.eegZoomFactor = DEFAULT_USER_PREFERENCES.eegZoomFactor;
        // Set a far-future expiration for local mode
        token.exp = Math.floor((Date.now() + 365 * 24 * 60 * 60 * 1000) / 1000); // 1 year
        return token;
      }

      // Fetch preferences for token (multi-user mode only)
      if (token.accessToken && (trigger === "signIn" || trigger === "update")) {
        try {
          const url = `/api/user-preferences`;
          const res = await get<UserPreferences>(url, token.accessToken);

          if (!res) throw new Error("Failed to fetch preferences");

          token.theme = res.theme ?? DEFAULT_USER_PREFERENCES.theme;
          token.eegZoomFactor =
            res.eegZoomFactor ?? DEFAULT_USER_PREFERENCES.eegZoomFactor;
          const sessionExpirationMs = SESSION_EXPIRATION * 60 * 1000;
          token.exp = Math.floor((Date.now() + sessionExpirationMs) / 1000);
        } catch (error) {
          console.error("JWT - Error fetching preferences:", error);
        }
      }

      const now = Math.floor(Date.now() / 1000);
      if (token.exp && token.exp < now) {
        throw new Error("Token expired");
      }

      if (Date.now() < (token.exp as number)) {
        return token;
      }

      // Refresh token (multi-user mode only)
      const authMode = await checkAuthMode();

      if (authMode.auth_mode === "local") {
        return token;
      }

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
          isLocalMode: token.isLocalMode ?? false,
          accessToken: token.accessToken,
        };
        session.accessToken = token.accessToken;
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
    const url = `/api/auth/refresh-token`;
    const refreshedTokens = await post<{
      access_token: string;
      expires_in: number;
    }>(url, { refresh_token: token.refreshToken }, token.accessToken);

    if (!refreshedTokens || !refreshedTokens.access_token) {
      throw new Error("Invalid refresh token response");
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: token.refreshToken,
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
