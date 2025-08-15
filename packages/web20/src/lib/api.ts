import { UserPreferences } from "@/types/user-preferences";
import { Layout } from "@/types/layouts";
import { DashboardStats } from "@/types/dashboard";
import env from "@/lib/env";

// API Configuration (single source of truth)
// Prefer relative base when using Next proxy to avoid browser CORS
const API_BASE_URL = "";

export const getApiBaseUrl = () => API_BASE_URL;

interface ApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

interface AuthResponse {
  access_token: string;
  expires_in: number;
  user: {
    id: string;
    username: string;
    email: string;
    first_name?: string;
    last_name?: string;
    is_active: boolean;
    is_admin: boolean;
  };
}

interface AuthModeResponse {
  auth_mode: "local" | "multi";
  current_user?: {
    id: string;
    username: string;
    email: string;
    first_name?: string;
    last_name?: string;
    is_active: boolean;
    is_admin: boolean;
  };
  error?: string;
}

class ApiService {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
    // Load token from localStorage on initialization
    if (typeof window !== "undefined") {
      this.token = localStorage.getItem("auth_token");
    }
  }

  private joinUrl(base: string, endpoint: string): string {
    const normalizedEndpoint = endpoint.startsWith("/")
      ? endpoint
      : `/${endpoint}`;
    // Route backend calls through Next proxy at /api-backend to avoid browser CORS
    const proxiedEndpoint = normalizedEndpoint.replace(
      /^\/api\b/,
      "/api-backend"
    );
    const finalEndpoint = proxiedEndpoint;
    // Always return relative URL to current origin
    return `${finalEndpoint}`;
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = this.joinUrl(this.baseUrl, endpoint);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    try {
      const controller = new AbortController();
      // Allow overriding timeout via custom header (x-timeout-ms); default 60s for heavy EDF calls
      const specifiedTimeout =
        (headers["x-timeout-ms"] as any) || (options as any)?.timeoutMs;
      const timeoutMs = specifiedTimeout ? Number(specifiedTimeout) : 60000;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const contentType = response.headers.get("content-type") || "";
      let data: any = null;
      let rawText: string | null = null;
      try {
        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          rawText = await response.text();
        }
      } catch (_) {
        // Swallow body parse errors and fall back to generic message
      }

      if (!response.ok) {
        const detail =
          data?.detail || data?.message || rawText || "An error occurred";
        return {
          error: detail,
          status: response.status,
        };
      }

      return {
        data: data ?? rawText,
        status: response.status,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Network error",
        status: 0,
      };
    }
  }

  // Authentication methods
  async getAuthMode(): Promise<ApiResponse<AuthModeResponse>> {
    return this.request<AuthModeResponse>("/api/auth/mode");
  }

  async login(
    username: string,
    password: string
  ): Promise<ApiResponse<AuthResponse>> {
    const formData = new FormData();
    formData.append("username", username);
    formData.append("password", password);

    const response = await fetch(
      this.joinUrl(this.baseUrl, "/api/auth/token"),
      {
        method: "POST",
        body: formData,
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        error: data.detail || "Login failed",
        status: response.status,
      };
    }

    // Store token
    this.token = data.access_token;
    if (typeof window !== "undefined") {
      localStorage.setItem("auth_token", data.access_token);
    }

    return {
      data,
      status: response.status,
    };
  }

  async refreshToken(refreshToken: string): Promise<ApiResponse<AuthResponse>> {
    const response = await this.request<AuthResponse>(
      "/api/auth/refresh-token",
      {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
      }
    );

    if (response.data) {
      this.token = response.data.access_token;
      if (typeof window !== "undefined") {
        localStorage.setItem("auth_token", response.data.access_token);
      }
    }

    return response;
  }

  setToken(token: string | null): void {
    this.token = token;
    if (typeof window !== "undefined") {
      if (token) {
        localStorage.setItem("auth_token", token);
      } else {
        localStorage.removeItem("auth_token");
      }
    }
  }

  logout(): void {
    this.setToken(null);
  }

  // Dashboard methods
  async getDashboardStats(): Promise<ApiResponse<DashboardStats>> {
    return this.request<DashboardStats>("/api/dashboard/stats");
  }

  async getUsers(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>("/api/dashboard/users");
  }

  // Layout methods
  async saveLayouts(
    layouts: Layout[]
  ): Promise<ApiResponse<{ status: string; message: string }>> {
    return this.request<{ status: string; message: string }>("/api/layouts", {
      method: "POST",
      body: JSON.stringify({ layouts }),
    });
  }

  async getLayouts(): Promise<ApiResponse<Layout[]>> {
    return this.request<Layout[]>("/api/layouts");
  }

  async deleteLayouts(): Promise<
    ApiResponse<{ status: string; message: string }>
  > {
    return this.request<{ status: string; message: string }>("/api/layouts", {
      method: "DELETE",
    });
  }

  // User preferences methods
  async getUserPreferences(): Promise<ApiResponse<UserPreferences>> {
    return this.request<UserPreferences>("/api/user-preferences");
  }

  async updateUserPreferences(
    preferences: Partial<UserPreferences>
  ): Promise<ApiResponse<UserPreferences>> {
    return this.request<UserPreferences>("/api/user-preferences", {
      method: "PUT",
      body: JSON.stringify(preferences),
    });
  }

  async resetUserPreferences(): Promise<ApiResponse<UserPreferences>> {
    return this.request<UserPreferences>("/api/user-preferences", {
      method: "DELETE",
    });
  }

  // Health check
  async healthCheck(): Promise<ApiResponse<{ status: string }>> {
    return this.request<{ status: string }>("/api/health");
  }

  // Widget data persistence methods
  async storeWidgetData(payload: {
    key: string;
    data: any;
    widgetId: string;
    metadata?: any;
  }): Promise<ApiResponse<{ status: string; message: string; dataKey: string }>> {
    return this.request<{ status: string; message: string; dataKey: string }>(
      "/api/widget-data",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  }

  async getWidgetData(
    dataKey: string
  ): Promise<ApiResponse<{ status: string; message: string; data: any }>> {
    return this.request<{ status: string; message: string; data: any }>(
      `/api/widget-data/${dataKey}`
    );
  }

  async deleteWidgetData(
    dataKey: string
  ): Promise<ApiResponse<{ status: string; message: string }>> {
    return this.request<{ status: string; message: string }>(
      `/api/widget-data/${dataKey}`,
      {
        method: "DELETE",
      }
    );
  }

  // Notification methods
  async getNotifications(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>("/api/notifications");
  }

  async getUnreadNotificationsCount(): Promise<ApiResponse<{ count: number }>> {
    return this.request<{ count: number }>("/api/notifications/unread-count");
  }

  async markNotificationAsRead(notificationId: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.request<{ success: boolean }>("/api/notifications/mark-read", {
      method: "POST",
      body: JSON.stringify({ notification_id: notificationId }),
    });
  }

  async markAllNotificationsAsRead(): Promise<ApiResponse<{ success: boolean; marked_count: number }>> {
    return this.request<{ success: boolean; marked_count: number }>("/api/notifications/mark-all-read", {
      method: "POST",
    });
  }

  async deleteNotification(notificationId: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.request<{ success: boolean }>(`/api/notifications/${notificationId}`, {
      method: "DELETE",
    });
  }

  async startNotificationMonitoring(): Promise<ApiResponse<{ success: boolean; message: string }>> {
    return this.request<{ success: boolean; message: string }>("/api/notifications/start-monitoring", {
      method: "POST",
    });
  }

  async stopNotificationMonitoring(): Promise<ApiResponse<{ success: boolean; message: string }>> {
    return this.request<{ success: boolean; message: string }>("/api/notifications/stop-monitoring", {
      method: "POST",
    });
  }

  async getSystemStatus(): Promise<ApiResponse<{
    cpu_percent: number;
    memory_percent: number;
    disk_percent: number;
    uptime_seconds: number;
    db_status: string;
    network_status: string;
    status: string;
    timestamp: string;
  }>> {
    return this.request("/api/notifications/system-status");
  }
}

// Create singleton instance
export const apiService = new ApiService();
export default apiService;
