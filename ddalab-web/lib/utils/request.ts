import axios, { AxiosResponse } from "axios";

export interface ApiRequestOptions {
  url: string; // Required
  token?: string; // Optional for endpoints that require authentication
  method?: string; // Optional, defaults to "GET"
  contentType?: string; // Optional, defaults to "application/json"
  body?: Record<string, any> | null; // Optional, can be any object or null
  headers?: Record<string, string>; // Optional, key-value pairs for headers
  responseType?: "json" | "response"; // Optional, defaults to 'response'
}

// Default response type if none specified
type DefaultResponse = Response;

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

  const defaultHeaders: Record<string, string> = {
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(body && { "Content-Type": contentType }),
    ...headers,
  };

  console.log("Full URL:", url);

  try {
    const axiosResponse: AxiosResponse = await axios({
      url,
      method,
      headers: defaultHeaders,
      data:
        body &&
        (contentType === "application/json"
          ? body
          : new URLSearchParams(body as Record<string, string>)),
    });

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
        `Request failed with status ${error.response?.status}: ${JSON.stringify(error.response?.data)}`
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
