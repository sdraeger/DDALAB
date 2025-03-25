import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

declare module "next-auth" {
  interface User {
    accessToken?: string;
    expiresIn?: number;
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
        sessionExpiration?: number;
        eegZoomFactor?: number;
        theme?: "light" | "dark" | "system";
      };
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    expiresIn?: number;
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
        if (!credentials?.username || !credentials?.password) {
          throw new Error("Missing credentials");
        }

        const res = await fetch("http://localhost:8001/api/auth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            username: credentials.username,
            password: credentials.password,
            grant_type: "password",
          }),
        });
        const data = await res.json();

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
          expiresIn: data.expires_in || 30 * 60,
        };

        console.log("Authorize user:", user);
        return user;
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
        token.expiresIn = user.expiresIn;
      }

      // Fetch preferences for token
      if (token.accessToken && (trigger === "signIn" || trigger === "update")) {
        try {
          const res = await fetch(
            "http://localhost:8001/api/user-preferences",
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token.accessToken}`,
              },
            }
          );

          if (!res.ok) throw new Error("Failed to fetch preferences");

          const data = await res.json();
          console.log("JWT - Preferences data:", data);

          token.sessionExpiration = data.session_expiration ?? 30 * 60;
          token.theme = data.theme ?? "system";
          token.eegZoomFactor = data.eeg_zoom_factor ?? 0.05;
          token.exp =
            Math.floor(Date.now() / 1000) +
            (data.session_expiration ?? 30 * 60);

          console.log("JWT - Preferences fetched:", {
            sessionExpiration: token.sessionExpiration,
            theme: token.theme,
            eegZoomFactor: token.eegZoomFactor,
          });
        } catch (error) {
          console.error("JWT - Error fetching preferences:", error);
        }
      }

      console.log("JWT token final:", token);
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
          preferences: {
            sessionExpiration: token.sessionExpiration as number,
            theme: token.theme as "light" | "dark" | "system",
            eegZoomFactor: token.eegZoomFactor as number,
          },
        };
        session.accessToken = token.accessToken;

        if (token.exp) {
          session.expires = new Date(
            (token.exp as number) * 1000
          ).toISOString();
          console.log("Session expires set to:", session.expires);
        }

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
    maxAge: 30 * 60,
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
