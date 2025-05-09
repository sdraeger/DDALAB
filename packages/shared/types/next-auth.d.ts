import "next-auth";
import { UserPreferences } from "./user";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      preferences?: UserPreferences;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    preferences?: UserPreferences;
  }
}
