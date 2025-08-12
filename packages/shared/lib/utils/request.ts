import logger from "./logger";

const requestLogger = logger.child({
  name: "Request",
});

const isBrowser = typeof window !== "undefined";

// Compute base URL at runtime
// - In the browser: call Next.js API routes directly (no '/backend' prefix)
// - On the server (Next API routes, SSR): call Python API directly via API_URL
const serverApiBase =
  (globalThis as any)?.process?.env?.API_URL || "http://localhost:8001";
const clientApiBase = ""; // Use direct Next.js routes like '/api/*' in the browser

function buildUrl(path: string): string {
  // Allow absolute URLs to pass through unchanged
  if (/^https?:\/\//i.test(path)) return path;

  // Ensure path starts with a leading slash
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  const base = isBrowser ? clientApiBase : serverApiBase;
  return `${base}${normalizedPath}`;
}

const handleResponse = async (response: Response) => {
  requestLogger.info(
    `Handling response for ${response.url}. Status: ${response.status}, OK: ${response.ok}`
  );
  if (!response.ok) {
    let errorMessage = "An unexpected error occurred";
    try {
      const errorData = await response.json();
      requestLogger.error(
        `Request failed: ${response.status} ${response.statusText}`,
        errorData
      );
      errorMessage =
        (errorData && (errorData.detail || errorData.message)) || errorMessage;
    } catch (_) {
      // ignore body parse errors
    }
    throw new Error(errorMessage);
  }
  return response.json();
};

export const get = async <T>(path: string, token?: string): Promise<T> => {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(buildUrl(path), { headers });
  return handleResponse(response);
};

export const put = async <T>(
  path: string,
  body: unknown,
  token?: string
): Promise<T> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(buildUrl(path), {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  return handleResponse(response);
};

export const post = async <T>(
  path: string,
  body: unknown,
  token?: string
): Promise<T> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(buildUrl(path), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return handleResponse(response);
};

export const patch = async <T>(
  path: string,
  body: unknown,
  token?: string
): Promise<T> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(buildUrl(path), {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  return handleResponse(response);
};

export const _delete = async <T>(path: string, token?: string): Promise<T> => {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(buildUrl(path), {
    method: "DELETE",
    headers,
  });
  return handleResponse(response);
};

// Backward-compatible generic request function used by some modules
export type ApiRequestOptions = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
  contentType?: string; // default: application/json
  responseType?: "json" | "response"; // compatibility
};

export async function apiRequest<T = any>(
  options: ApiRequestOptions
): Promise<T> {
  const {
    url,
    method = "GET",
    body,
    token,
    headers = {},
    contentType,
  } = options;
  const finalHeaders: Record<string, string> = { ...headers };
  const ct =
    contentType ??
    (body instanceof URLSearchParams
      ? "application/x-www-form-urlencoded"
      : "application/json");
  if (method !== "GET") {
    finalHeaders["Content-Type"] = ct;
  }
  if (token) {
    finalHeaders["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(buildUrl(url), {
    method,
    headers: finalHeaders,
    body:
      body == null
        ? undefined
        : ct === "application/json"
          ? JSON.stringify(body)
          : (body as any),
  });

  if (options.responseType === "response") {
    // @ts-expect-error allow raw Response
    return response;
  }
  return handleResponse(response);
}
