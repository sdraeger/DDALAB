import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getSessionExpiration } from "@/lib/user-preferences";

declare module "next-auth" {
  interface User {
    accessToken?: string;
    expiresIn?: number;
  }

  interface Session {
    accessToken?: string;
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
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
          id: credentials.username,
          name: credentials.username,
          email: null,
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
        token.accessToken = user.accessToken;
        token.expiresIn = user.expiresIn;
        console.log("JWT - Token after user:", token);
      }

      if (trigger === "signIn" || trigger === "update") {
        const maxAge = await getSessionExpiration();
        const expires = Math.floor(Date.now() / 1000) + maxAge;
        token.exp = expires;
        console.log("JWT exp set to:", expires);
      }

      console.log("JWT token final:", token);
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user = {
          id: token.id as string,
          name: token.name as string,
          email: (token.email as string) || null,
        };
        session.accessToken = token.accessToken; // Pass accessToken to session

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
