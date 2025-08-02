import axios, { AxiosResponse } from "axios";

export interface ApiRequestOptions {
  url: string; // Required
  token?: string; // Optional for endpoints that require authentication
  method?: string; // Optional, defaults to "GET"
  contentType?: string; // Optional, defaults to "application/json"
  body?: Record<string, any> | FormData | null; // Optional, can be any object, FormData, or null
  headers?: Record<string, string>; // Optional, key-value pairs for headers
  responseType?: "json" | "response"; // Optional, defaults to 'response'
}

// Default response type if none specified
type DefaultResponse = Response;

// Helper function to get the correct base URL for API requests
function getApiBaseUrl(url: string): string {
  // If URL is already absolute, return as-is
  if (url.startsWith("http://") || url.startsWith("https://")) {
    console.log(`[API Request] URL is already absolute: ${url}`);
    return url;
  }

  // Check if we're in a browser environment
  if (typeof window !== "undefined") {
    // Check if we're in development mode (multiple ways to detect this)
    const isDevelopment =
      process.env.NODE_ENV === "development" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.port === "3000";

    if (isDevelopment) {
      // Routes that should go to Next.js directly (same origin) to avoid CORS
      // Only NextAuth.js specific routes, not all /api/auth/ routes
      const nextjsRoutes = [
        "/api/auth/signin",
        "/api/auth/signout",
        "/api/auth/session",
        "/api/auth/csrf",
        "/api/auth/providers",
        "/api/auth/callback",
        "/api/debug",
      ];

      const isNextjsRoute = nextjsRoutes.some((route) => url.startsWith(route));

      console.log(`[API Request] Route detection for ${url}:`, {
        nextjsRoutes,
        isNextjsRoute,
        currentUrl: window.location.href,
        port: window.location.port,
      });

      if (isNextjsRoute) {
        // Force same-origin by using the Next.js dev server directly
        const nextjsUrl = `http://localhost:3000${url}`;
        console.log(
          `[API Request] Browser + Development (Next.js route): ${url} -> ${nextjsUrl} (direct to Next.js)`
        );
        return nextjsUrl;
      } else {
        // For Python API routes, use the NEXT_PUBLIC_API_URL environment variable
        const apiUrl =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
        const resolvedUrl = `${apiUrl}${url}`;
        console.log(
          `[API Request] Browser + Development (API route): ${url} -> ${resolvedUrl}`
        );
        return resolvedUrl;
      }
    }
    // In production, use relative URLs (same domain)
    console.log(`[API Request] Browser + Production: ${url} (relative)`);
    return url;
  }

  // Server-side: use the API_URL environment variable or fallback
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL;
  if (apiUrl && url.startsWith("/api/")) {
    const resolvedUrl = `${apiUrl}${url}`;
    console.log(`[API Request] Server-side: ${url} -> ${resolvedUrl}`);
    return resolvedUrl;
  }

  console.log(`[API Request] Fallback: ${url} (unchanged)`);
  return url;
}

export async function apiRequest<T = DefaultResponse>(
  options: ApiRequestOptions & { responseType: "json" }
): Promise<T>;
export async function apiRequest(
  options: ApiRequestOptions & { responseType: "response" }
): Promise<Response>;
export async function apiRequest<T = DefaultResponse>(
  options: ApiRequestOptions
): Promise<T | Response> {
  const {
    url,
    token,
    method = "GET",
    contentType = "application/json",
    body = null,
    headers = {},
    responseType = "response",
  } = options;

  // Get the full URL with proper base
  const fullUrl = getApiBaseUrl(url);

  // Check if body is FormData
  const isFormData = body instanceof FormData;

  const defaultHeaders: Record<string, string> = {
    ...(token && { Authorization: `Bearer ${token}` }),
    // Only set Content-Type if it's not FormData (browser sets it with boundary for FormData)
    ...(body && !isFormData && { "Content-Type": contentType }),
    ...headers,
  };

  try {
    let data;
    if (body) {
      if (isFormData) {
        // For FormData, pass it directly
        data = body;
      } else if (contentType === "application/json") {
        // For JSON, pass the object as-is (axios will stringify it)
        data = body;
      } else {
        // For other content types, convert to URLSearchParams
        data = new URLSearchParams(body as Record<string, string>);
      }
    }

    // Configure request options
    const requestConfig: any = {
      url: fullUrl,
      method,
      headers: defaultHeaders,
      data,
    };

    // For cross-origin requests to Next.js routes, include credentials (cookies)
    // Also include credentials for requests to https://localhost (Traefik proxy)
    if (
      (fullUrl.startsWith("http://localhost:3000") ||
        fullUrl.startsWith("https://localhost")) &&
      typeof window !== "undefined"
    ) {
      requestConfig.withCredentials = true;
      console.log(
        "[API Request] Adding credentials for cross-origin request to:",
        fullUrl
      );
    }

    const axiosResponse: AxiosResponse = await axios(requestConfig);

    // Return Response object if responseType is 'response'
    if (responseType === "response") {
      return new Response(JSON.stringify(axiosResponse.data), {
        status: axiosResponse.status,
        statusText: axiosResponse.statusText,
        headers: new Headers(axiosResponse.headers as Record<string, string>),
      }) as T extends DefaultResponse ? Response : T;
    }

    // Otherwise return the data directly as the specified type
    return axiosResponse.data as T extends DefaultResponse ? Response : T;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        `Request failed with status ${error.response?.status}: ${JSON.stringify(
          error.response?.data
        )}`
      );

      if (responseType === "response") {
        return new Response(JSON.stringify(error.response?.data), {
          status: error.response?.status || 500,
          statusText: error.response?.statusText || error.message,
          headers: new Headers(
            error.response?.headers as Record<string, string>
          ),
        }) as T extends DefaultResponse ? Response : T;
      }

      throw error; // Re-throw for custom types to handle errors themselves
    }

    if (responseType === "response") {
      return new Response(
        JSON.stringify({ message: "An unexpected error occurred" }),
        {
          status: 500,
          statusText: "Internal Server Error",
        }
      ) as T extends DefaultResponse ? Response : T;
    }

    throw new Error("An unexpected error occurred");
  }
}
