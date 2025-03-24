import { type NextRequest, NextResponse } from "next/server";
import https from "https";
import fs from "fs";
import { getEnvVar } from "@/lib/utils/env";
import logger from "@/lib/utils/logger";

// Environment variables
const caPath = getEnvVar("API_SSL_CERT_PATH", "../ssl/cert.pem");
const baseUrl = getEnvVar("NEXT_PUBLIC_API_URL", "https://localhost:8001");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Get authorization header
    const authHeader = request.headers.get("authorization");

    // Load the CA certificate
    const ca = fs.readFileSync(caPath);
    logger.info("Using CA from:", caPath); // Keep this for debugging

    // Get the base URL from environment variable
    const url = new URL(`${baseUrl}/graphql`);

    // Prepare the request body
    const requestBody = JSON.stringify(body);

    // Configure the HTTPS request
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody),
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      ca, // Trust the self-signed certificate
    };

    // Make the request
    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const jsonData = JSON.parse(data); // Assuming GraphQL returns JSON
            resolve(NextResponse.json(jsonData, { status: res.statusCode }));
          } catch (e) {
            logger.error("Response parse error:", e);
            resolve(
              NextResponse.json(
                { errors: [{ message: "Invalid response format" }] },
                { status: 500 }
              )
            );
          }
        });
      });

      req.on("error", (error) => {
        logger.error("HTTPS request error:", error);
        resolve(
          NextResponse.json(
            { errors: [{ message: error.message }] },
            { status: 500 }
          )
        );
      });

      // Write the JSON body
      req.write(requestBody);
      req.end();
    });
  } catch (error) {
    logger.error("GraphQL proxy error:", error);
    return NextResponse.json(
      {
        errors: [
          { message: error instanceof Error ? error.message : "Unknown error" },
        ],
      },
      { status: 500 }
    );
  }
}
