"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  type User,
  loginUser,
  logoutUser,
  getCurrentUser,
  isAuthenticated,
  type LoginCredentials,
  registerUser,
  type RegisterCredentials,
} from "@/lib/auth";
import { toast } from "@/hooks/use-toast";
import { useToast } from "@/components/ui/use-toast";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  isLoggedIn: boolean;
  register: (credentials: RegisterCredentials) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { toast } = useToast();

  // Check if user is already logged in
  useEffect(() => {
    const checkAuth = () => {
      if (isAuthenticated()) {
        const currentUser = getCurrentUser();
        setUser(currentUser);
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  // Login function
  const login = async (credentials: LoginCredentials) => {
    try {
      setLoading(true);

      // Always use real login
      const response = await loginUser(credentials);

      setUser(
        response.user || {
          id: "1",
          username: credentials.username,
          name: credentials.username,
        }
      );

      toast({
        title: "Login successful",
        description: `Welcome back, ${
          response.user?.name || credentials.username
        }!`,
      });

      // Redirect to dashboard
      router.push("/dashboard");
    } catch (error) {
      toast({
        title: "Login failed",
        description:
          error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Logout function
  const logout = () => {
    logoutUser();
    setUser(null);
    toast({
      title: "Logged out",
      description: "You have been successfully logged out",
    });
    router.push("/login");
  };

  // Register function
  const register = async (credentials: RegisterCredentials) => {
    setLoading(true);
    try {
      const response = await registerUser(credentials);
      if (response.user) {
        setUser(response.user);
      }
      toast({
        title: "Registration successful",
        description: "Welcome to DDALAB!",
      });
      router.push("/dashboard");
    } catch (error: any) {
      console.error("Registration error:", error);
      toast({
        variant: "destructive",
        title: "Registration failed",
        description: error.message || "Please try again later.",
      });
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const value = {
    user,
    loading,
    login,
    logout,
    isLoggedIn: !!user,
    register,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
