import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

// CORS headers for development to allow requests from Traefik proxy
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://localhost",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
  "Access-Control-Allow-Credentials": "true",
};

// Python API base URL - using Traefik to route to Python backend
const PYTHON_API_BASE =
  process.env.NODE_ENV === "development"
    ? "https://localhost/api" // Through Traefik in development
    : process.env.PYTHON_API_URL || "http://api:8000"; // Direct in production

async function proxyToPythonAPI(
  endpoint: string,
  method: string,
  token: string,
  body?: any
) {
  const url = `${PYTHON_API_BASE}${endpoint}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const options: RequestInit = {
    method,
    headers,
    // Disable SSL verification for development with self-signed certs
    ...(process.env.NODE_ENV === "development" && {
      // @ts-ignore - For development only
      rejectUnauthorized: false,
    }),
  };

  if (body && (method === "POST" || method === "PUT")) {
    options.body = JSON.stringify(body);
  }

  console.log(`Proxying ${method} request to Python API:`, url);

  const response = await fetch(url, options);
  return response;
}

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request });

    if (!token?.sub || !token.accessToken) {
      console.warn("Unauthorized request to DDA endpoint");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();

    // Proxy to Python API
    const response = await proxyToPythonAPI(
      "/dda",
      "POST",
      token.accessToken as string,
      body
    );

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      console.error("Python API error:", response.status, errorData);
      return NextResponse.json(
        { error: errorData.message || "Failed to process DDA request" },
        { status: response.status, headers: corsHeaders }
      );
    }

    const result = await response.json();
    return NextResponse.json(result, { headers: corsHeaders });
  } catch (error) {
    console.error("Error processing DDA request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}
