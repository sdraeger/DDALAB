import NextAuth, {
  NextAuthOptions,
  DefaultSession,
  DefaultUser,
} from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

// Check authentication mode from API
async function checkAuthMode(): Promise<{
  current_user?: any;
  auth_mode: string;
}> {
  try {
    // Use absolute URL for server-side requests
    const apiUrl = process.env.API_URL || process.env.API_BASE_URL || 'http://localhost:8001';
    const response = await fetch(`${apiUrl}/api/auth/mode`);
    if (response.ok) {
      const data = await response.json();
      return data;
    }
    return { auth_mode: "local" };
  } catch (error) {
    console.error("Failed to check auth mode:", error);
    return { auth_mode: "local" };
  }
}

declare module "next-auth" {
  export interface Session extends DefaultSession {
    accessToken?: string;
    user?: {
      id: string;
      firstName?: string | null;
      lastName?: string | null;
      isLocalMode?: boolean;
      accessToken?: string;
    } & DefaultSession["user"];
  }

  export interface User extends DefaultUser {
    firstName?: string | null;
    lastName?: string | null;
    accessToken?: string;
    refreshToken?: string;
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
    isLocalMode?: boolean;
  }
}

const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET || "dev-nextauth-secret-key-for-development-only",
  debug: process.env.NODE_ENV === "development",
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
              accessToken: "local-mode-token",
              refreshToken: "local-mode-token",
              isLocalMode: true,
            };
          } else {
            throw new Error("Local mode user not available");
          }
        }

        // Multi-user mode - require credentials
        if (!credentials?.username || !credentials?.password) {
          throw new Error("Missing credentials");
        }

        try {
          const apiUrl = process.env.API_URL || process.env.API_BASE_URL || 'http://localhost:8001';
          const res = await fetch(`${apiUrl}/api/auth/token`, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              username: credentials.username,
              password: credentials.password,
              grant_type: "password",
            }),
          });

          if (!res.ok) {
            throw new Error("Login failed");
          }

          const data = await res.json();

          if (!data.access_token) {
            throw new Error("Login failed");
          }

          const user = {
            id: data.user.id.toString(),
            name: data.user.username,
            email: data.user.email,
            firstName: data.user.firstName,
            lastName: data.user.lastName,
            accessToken: data.access_token,
            refreshToken: data.access_token,
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
        // Set a far-future expiration for local mode
        token.exp = Math.floor((Date.now() + 365 * 24 * 60 * 60 * 1000) / 1000); // 1 year
        return token;
      }

      // Check token expiration
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

      // For now, return token as is - refresh logic can be added later
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user = {
          id: token.id as string,
          name: token.name ?? null,
          email: token.email ?? null,
          firstName: token.firstName ?? null,
          lastName: token.lastName ?? null,
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

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
