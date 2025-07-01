import NextAuth, {
  NextAuthOptions,
  DefaultSession,
  DefaultUser,
} from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { DEFAULT_USER_PREFERENCES } from "shared/contexts/SettingsContext";
import { getEnvVar } from "shared/lib/utils/env";
import { apiRequest } from "shared/lib/utils/request";
import { TokenResponse, UserPreferences } from "shared/types/auth";

// Fix for development environment - use localhost instead of Docker hostname
const rawApiUrl = getEnvVar("NEXT_PUBLIC_API_URL");
const API_URL =
  process.env.NODE_ENV === "development" && rawApiUrl.includes("api:8001")
    ? "http://localhost:8001"
    : rawApiUrl;

const SESSION_EXPIRATION = parseInt(getEnvVar("SESSION_EXPIRATION"));

declare module "next-auth" {
  export interface Session extends DefaultSession {
    accessToken?: string;
    user?: {
      id: string;
      firstName?: string | null;
      lastName?: string | null;
      preferences?: UserPreferences;
    } & DefaultSession["user"];
  }

  export interface User extends DefaultUser {
    firstName?: string | null;
    lastName?: string | null;
    accessToken?: string;
    refreshToken?: string;
    preferences?: UserPreferences;
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
        const url = `${API_URL}/api/auth/token`;

        if (!credentials?.username || !credentials?.password) {
          throw new Error("Missing credentials");
        }

        try {
          const res = await apiRequest<TokenResponse>({
            url,
            method: "POST",
            contentType: "application/x-www-form-urlencoded",
            body: new URLSearchParams({
              username: credentials.username,
              password: credentials.password,
              grant_type: "password",
            }),
            responseType: "json",
          });

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
      }

      // Fetch preferences for token
      if (token.accessToken && (trigger === "signIn" || trigger === "update")) {
        try {
          const url = `${API_URL}/api/user-preferences`;
          const res = await apiRequest<UserPreferences>({
            url,
            token: token.accessToken,
            method: "GET",
            contentType: "application/json",
            responseType: "json",
          });

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
    const url = `${API_URL}/api/auth/refresh-token`;
    const refreshedTokens = await apiRequest<{
      access_token: string;
      expires_in: number;
    }>({
      url,
      method: "POST",
      body: { refresh_token: token.refreshToken },
      contentType: "application/json",
      responseType: "json",
    });

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
