export interface UserPreferences {
  theme?: "light" | "dark" | "system";
  eegZoomFactor?: number;
}

export interface User {
  id: string;
  username: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  image?: string | null;
  role?: string;
  isActive?: boolean;
  isAdmin?: boolean;
  preferences?: UserPreferences;
  accessToken?: string;
  refreshToken?: string;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: string;
  user: User;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  user: User;
}
