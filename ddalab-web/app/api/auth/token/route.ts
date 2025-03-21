import { type NextRequest, NextResponse } from "next/server";
import https from "https";
import { getEnvVar } from "@/lib/utils/env";

// Environment variables
const baseUrl = getEnvVar("NEXT_PUBLIC_API_URL");

export async function POST(request: NextRequest) {
  try {
    // Parse credentials from request body (handle both JSON and form-urlencoded)
    let username: string;
    let password: string;

    const contentType = request.headers.get("content-type") || "";

    console.log("Received auth request with content type:", contentType);

    if (contentType.includes("application/json")) {
      // Handle JSON request
      const body = await request.json();
      username = body.username;
      password = body.password;
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      // Handle form-urlencoded request
      const formData = await request.formData();
      username = formData.get("username") as string;
      password = formData.get("password") as string;
    } else {
      // Try to get text and parse as form data as fallback
      const text = await request.text();
      const params = new URLSearchParams(text);
      username = params.get("username") || "";
      password = params.get("password") || "";
    }

    if (!username || !password) {
      return NextResponse.json(
        { error: "Missing username or password" },
        { status: 400 }
      );
    }

    // Convert to URL-encoded form data for the backend
    const formData = new URLSearchParams({
      username,
      password,
    }).toString();

    // Get the base URL from environment variable
    const url = new URL(`${baseUrl}/api/auth/backend-token`);

    console.log("Auth request will be sent to:", url.toString());

    // Configure the HTTPS request
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(formData),
      },
      rejectUnauthorized: false, // DISABLE SSL VERIFICATION FOR DEVELOPMENT
    };

    // For production, we'd use proper SSL certs instead of disabling verification
    console.log("SSL verification disabled for development environment");

    // Make the request
    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const jsonData = JSON.parse(data); // Assuming the response is JSON

            // Add expires_in field if not present in response
            // This is based on the default JWT token expiration of 30 minutes
            if (!jsonData.expires_in && jsonData.access_token) {
              console.log("Adding default token expiration time (30 minutes)");
              jsonData.expires_in = 30 * 60; // 30 minutes in seconds
            }

            resolve(NextResponse.json(jsonData, { status: res.statusCode }));
          } catch (e) {
            resolve(
              NextResponse.json(
                { error: "Invalid response format" },
                { status: 500 }
              )
            );
          }
        });
      });

      req.on("error", (error) => {
        console.error("HTTPS request error:", error);
        resolve(NextResponse.json({ error: error.message }, { status: 500 }));
      });

      // Write the form-encoded body
      req.write(formData);
      req.end();
    });
  } catch (error) {
    console.error("Auth proxy error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
