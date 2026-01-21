/**
 * HTTP client wrapper that uses Tauri's HTTP plugin for localhost HTTPS
 * (which can bypass certificate validation) and falls back to axios for other requests.
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";

// Check if we're in a Tauri environment
const isTauri = () => {
  return typeof window !== "undefined" && "__TAURI__" in window;
};

// Check if URL is a localhost HTTPS URL
const isLocalhostHttps = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "0.0.0.0")
    );
  } catch {
    return false;
  }
};

/**
 * HTTP client that uses Tauri's fetch for localhost HTTPS and axios for everything else.
 * This solves the Windows certificate validation issue where axios rejects self-signed certs.
 */
export class TauriHttpClient {
  private axiosInstance: AxiosInstance;
  private tauriFetch: typeof fetch | null = null;

  constructor(config: AxiosRequestConfig = {}) {
    this.axiosInstance = axios.create(config);

    // Import Tauri's fetch if available
    if (isTauri()) {
      import("@tauri-apps/plugin-http").then((module) => {
        this.tauriFetch = module.fetch;
      });
    }
  }

  /**
   * Perform a GET request
   */
  async get<T = any>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const fullUrl = this.buildUrl(url, config);

    // Use Tauri fetch for localhost HTTPS
    if (this.tauriFetch && isLocalhostHttps(fullUrl)) {
      return this.tauriRequest<T>("GET", fullUrl, undefined, config);
    }

    // Use axios for everything else
    return this.axiosInstance.get<T>(url, config);
  }

  /**
   * Perform a POST request
   */
  async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const fullUrl = this.buildUrl(url, config);

    // Use Tauri fetch for localhost HTTPS
    if (this.tauriFetch && isLocalhostHttps(fullUrl)) {
      return this.tauriRequest<T>("POST", fullUrl, data, config);
    }

    // Use axios for everything else
    return this.axiosInstance.post<T>(url, data, config);
  }

  /**
   * Perform a PUT request
   */
  async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const fullUrl = this.buildUrl(url, config);

    // Use Tauri fetch for localhost HTTPS
    if (this.tauriFetch && isLocalhostHttps(fullUrl)) {
      return this.tauriRequest<T>("PUT", fullUrl, data, config);
    }

    // Use axios for everything else
    return this.axiosInstance.put<T>(url, data, config);
  }

  /**
   * Perform a DELETE request
   */
  async delete<T = any>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const fullUrl = this.buildUrl(url, config);

    // Use Tauri fetch for localhost HTTPS
    if (this.tauriFetch && isLocalhostHttps(fullUrl)) {
      return this.tauriRequest<T>("DELETE", fullUrl, undefined, config);
    }

    // Use axios for everything else
    return this.axiosInstance.delete<T>(url, config);
  }

  /**
   * Build full URL from base URL and path
   */
  private buildUrl(url: string, config?: AxiosRequestConfig): string {
    const baseURL =
      config?.baseURL || this.axiosInstance.defaults.baseURL || "";

    // If URL is already absolute, use it as-is
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }

    // Otherwise combine with base URL
    return baseURL + url;
  }

  /**
   * Perform request using Tauri's fetch (which can bypass certificate validation)
   */
  private async tauriRequest<T>(
    method: string,
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    if (!this.tauriFetch) {
      throw new Error("Tauri fetch not available");
    }

    try {
      const headers: Record<string, string> = {
        ...(this.axiosInstance.defaults.headers.common as Record<
          string,
          string
        >),
        ...(config?.headers as Record<string, string>),
      };

      // Handle request body
      let body: BodyInit | undefined;
      if (data) {
        if (data instanceof Blob) {
          body = data;
        } else if (data instanceof FormData) {
          body = data;
        } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
          body = data as ArrayBuffer;
        } else {
          // Serialize as JSON
          body = JSON.stringify(data);
          if (!headers["Content-Type"]) {
            headers["Content-Type"] = "application/json";
          }
        }
      }

      // Build query string from params
      let finalUrl = url;
      if (config?.params) {
        const params = new URLSearchParams();
        Object.entries(config.params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            params.append(key, String(value));
          }
        });
        const queryString = params.toString();
        if (queryString) {
          finalUrl += (finalUrl.includes("?") ? "&" : "?") + queryString;
        }
      }

      const response = await this.tauriFetch(finalUrl, {
        method,
        headers,
        body,
        signal: config?.signal as AbortSignal | undefined,
      });

      // Parse response body
      let responseData: T;
      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        responseData = (await response.json()) as T;
      } else if (config?.responseType === "arraybuffer") {
        responseData = (await response.arrayBuffer()) as T;
      } else if (config?.responseType === "blob") {
        responseData = (await response.blob()) as T;
      } else {
        responseData = (await response.text()) as T;
      }

      // Return axios-compatible response
      const axiosResponse: AxiosResponse<T> = {
        data: responseData,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        config: (config || {}) as any,
      } as AxiosResponse<T>;

      return axiosResponse;
    } catch (error) {
      // Convert to axios-like error
      throw {
        message: error instanceof Error ? error.message : "Network Error",
        config,
        isAxiosError: true,
      };
    }
  }

  /**
   * Create a new instance with merged config
   */
  create(config?: AxiosRequestConfig): TauriHttpClient {
    // Just pass the config, don't try to merge with defaults (complex types)
    return new TauriHttpClient(config);
  }

  /**
   * Access the underlying axios instance for advanced usage
   */
  get axios(): AxiosInstance {
    return this.axiosInstance;
  }
}

/**
 * Create an HTTP client instance
 */
export function createHttpClient(config?: AxiosRequestConfig): TauriHttpClient {
  return new TauriHttpClient(config);
}
