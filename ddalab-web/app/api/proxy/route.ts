import { type NextRequest, NextResponse } from "next/server";
import { createHttpsAgent } from "@/lib/ssl-utils";

// This is a server-side API route that can use Node.js modules
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, method = "GET", headers = {}, data } = body;

    // Create HTTPS agent with SSL certificates
    const httpsAgent = await createHttpsAgent();

    // Configure fetch options
    const fetchOptions: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      // @ts-ignore - TypeScript doesn't recognize agent in RequestInit
      agent: httpsAgent,
    };

    // Add body for non-GET requests
    if (method !== "GET" && data) {
      fetchOptions.body = JSON.stringify(data);
    }

    // Make the request
    const response = await fetch(url, fetchOptions);

    // Get response data
    const responseData = await response.json();

    // Return response
    return NextResponse.json(responseData, {
      status: response.status,
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
