export interface TokenResponse {
  access_token: string;
  expires_in: number;
  user: User;
}

export interface User {
  id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
}
