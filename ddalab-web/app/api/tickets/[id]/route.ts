import { type NextRequest, NextResponse } from "next/server";
import https from "https";
import fs from "fs";
import logger from "@/lib/utils/logger";

// Directus ticket collection name
const TICKETS_COLLECTION = "help_tickets";

// Helper function to make authenticated requests to Directus
async function directusRequest(path: string, options: any = {}) {
  try {
    // Load the CA certificate
    const caPath = process.env.API_SSL_CERT_PATH || "../ssl/cert.pem";
    const ca = fs.readFileSync(caPath);

    // Get the Directus URL from environment variables
    const directusUrl = process.env.DIRECTUS_URL || "http://localhost:8055";
    const url = new URL(`${directusUrl}${path}`);

    // Set default headers
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    // Configure the request options
    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || "GET",
      headers,
      ca, // Trust the self-signed certificate if HTTPS
    };

    // Make the request
    return new Promise((resolve, reject) => {
      const req = https.request(requestOptions, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const jsonData = JSON.parse(data);
            resolve({ statusCode: res.statusCode, data: jsonData });
          } catch (e) {
            const error = e as Error;
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on("error", (e) => {
        const error = e as Error;
        reject(new Error(`Request failed: ${error.message}`));
      });

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }
      req.end();
    });
  } catch (e) {
    const error = e as Error;
    logger.error("Directus request error:", error);
    throw error;
  }
}

// Helper to check if user is authenticated using auth token
async function isAuthenticated(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  // No auth header means not authenticated
  if (!authHeader) return false;

  // Extract token from auth header
  const token = authHeader.split(" ")[1];
  if (!token) return false;

  // Check if token exists in localStorage (simplified auth check)
  // In a real-world app, you'd verify with your auth service
  return true;
}

// Get user info from auth token
async function getUserFromToken(request: NextRequest) {
  try {
    // In a real implementation, you would decode the JWT or fetch the user data
    // Here we're returning a mock user for demonstration
    return {
      id: "1", // This would normally come from the decoded token
      username: "user",
    };
  } catch (e) {
    const error = e as Error;
    logger.error("Error getting user from token:", error);
    return null;
  }
}

// Get a specific ticket by ID
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // Check if user is authenticated
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ensure params is awaited before accessing properties
    const params = await context.params;
    const ticketId = params.id;
    if (!ticketId) {
      return NextResponse.json({ error: "Invalid ticket ID" }, { status: 400 });
    }

    // Forward the request to the server endpoint
    const apiUrl = process.env.API_URL || "https://localhost:8001";

    // Use URL parsing to ensure proper path handling with nginx
    const baseUrl = new URL(apiUrl);
    const apiPath = `/api/tickets/${ticketId}`;

    // When working with nginx, we need to be careful about path handling
    // baseUrl.pathname might already have a trailing slash
    const basePath = baseUrl.pathname.endsWith("/")
      ? baseUrl.pathname.slice(0, -1)
      : baseUrl.pathname;

    // Construct the complete URL with proper path handling
    const endpoint = `${baseUrl.protocol}//${baseUrl.host}${basePath}${apiPath}`;

    logger.info(`Forwarding GET request to: ${endpoint}`);

    try {
      // Get SSL certificate if needed
      let rejectUnauthorized = false; // Set to false by default for development
      let ca = undefined;
      if (apiUrl.startsWith("https://")) {
        try {
          const caPath = process.env.API_SSL_CERT_PATH || "./ssl/cert.pem";
          if (fs.existsSync(caPath)) {
            ca = fs.readFileSync(caPath);
            logger.info("SSL certificate loaded successfully");
          } else {
            logger.warn(
              `CA certificate not found at ${caPath}, proceeding with rejectUnauthorized=false`
            );
          }
        } catch (certError) {
          logger.warn(
            `Error loading certificate: ${
              (certError as Error).message
            }, proceeding with rejectUnauthorized=false`
          );
        }
      }

      const url = new URL(endpoint);
      const requestOptions: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: authHeader,
        },
      };

      if (url.protocol === "https:") {
        if (ca) requestOptions.ca = ca;
        requestOptions.rejectUnauthorized = rejectUnauthorized;
      }

      // Make the request to the server
      const serverResponse = await new Promise<{
        statusCode: number;
        data: any;
      }>((resolve, reject) => {
        const httpModule = url.protocol === "https:" ? https : require("http");
        const req = httpModule.request(requestOptions, (res: any) => {
          let data = "";
          res.on("data", (chunk: any) => {
            data += chunk;
          });

          res.on("end", () => {
            // Check if we got a redirect
            if (res.statusCode >= 300 && res.statusCode < 400) {
              logger.info(
                `Received redirect (${res.statusCode}) to: ${res.headers.location}`
              );
              return resolve({
                statusCode: res.statusCode,
                data: {
                  error: `Redirect received. Your API may need direct access configuration.`,
                  redirect: res.headers.location,
                },
              });
            }

            // Check content type for HTML response
            const contentType = res.headers["content-type"] || "";
            const isHtml = contentType.includes("text/html");

            if (isHtml) {
              logger.warn(
                "Received HTML response instead of JSON. This likely indicates a server configuration issue."
              );
              logger.warn(
                `Status code: ${res.statusCode}, Content-Type: ${contentType}`
              );
              logger.warn(
                "HTML content preview:",
                data.substring(0, 200) + "..."
              );

              return resolve({
                statusCode: 500,
                data: {
                  error:
                    "Received HTML response instead of JSON. Check your API server configuration.",
                },
              });
            }

            try {
              let responseData;
              if (data && data.trim()) {
                try {
                  responseData = JSON.parse(data);
                } catch (parseError) {
                  logger.error(
                    "Failed to parse response as JSON:",
                    (parseError as Error).message
                  );
                  logger.error("Response preview:", data.substring(0, 200));

                  return resolve({
                    statusCode: 500,
                    data: {
                      error: `Failed to parse server response: ${
                        (parseError as Error).message
                      }`,
                      responsePreview: data.substring(0, 200),
                    },
                  });
                }
              } else {
                responseData = {};
              }

              resolve({
                statusCode: res.statusCode || 200,
                data: responseData,
              });
            } catch (error) {
              logger.error("Error processing response:", error);
              reject(
                new Error(
                  `Failed to process response: ${(error as Error).message}`
                )
              );
            }
          });
        });

        req.on("error", (error: Error) => {
          logger.error("Network error during request:", error.message);
          reject(error);
        });

        // Set request timeout
        req.setTimeout(15000, () => {
          logger.error("Request timed out after 15 seconds");
          req.destroy();
          reject(new Error("Request timed out after 15 seconds"));
        });

        req.end();
      });

      if (serverResponse.statusCode >= 400) {
        return NextResponse.json(serverResponse.data, {
          status: serverResponse.statusCode,
        });
      }

      return NextResponse.json(serverResponse.data);
    } catch (error) {
      logger.error("Error fetching ticket from server:", error);
      return NextResponse.json(
        { error: `Failed to retrieve ticket: ${(error as Error).message}` },
        { status: 500 }
      );
    }
  } catch (error) {
    logger.error("Get ticket error:", error);
    return NextResponse.json(
      { error: `Failed to retrieve ticket: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}

// Update a ticket
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // Check if user is authenticated
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ensure params is awaited before accessing properties
    const params = await context.params;
    const ticketId = params.id;
    if (!ticketId) {
      return NextResponse.json({ error: "Invalid ticket ID" }, { status: 400 });
    }

    const body = await request.json();

    // Forward the request to the server endpoint
    const apiUrl = process.env.API_URL || "https://localhost:8001";

    // Use URL parsing to ensure proper path handling with nginx
    const baseUrl = new URL(apiUrl);
    const apiPath = `/api/tickets/${ticketId}`;

    // When working with nginx, we need to be careful about path handling
    // baseUrl.pathname might already have a trailing slash
    const basePath = baseUrl.pathname.endsWith("/")
      ? baseUrl.pathname.slice(0, -1)
      : baseUrl.pathname;

    // Construct the complete URL with proper path handling
    const endpoint = `${baseUrl.protocol}//${baseUrl.host}${basePath}${apiPath}`;

    logger.info(`Forwarding PATCH request to: ${endpoint}`);

    try {
      // Get SSL certificate if needed
      let rejectUnauthorized = false; // Set to false by default for development
      let ca = undefined;
      if (apiUrl.startsWith("https://")) {
        try {
          const caPath = process.env.API_SSL_CERT_PATH || "./ssl/cert.pem";
          if (fs.existsSync(caPath)) {
            ca = fs.readFileSync(caPath);
            logger.info("SSL certificate loaded successfully");
          } else {
            logger.warn(
              `CA certificate not found at ${caPath}, proceeding with rejectUnauthorized=false`
            );
          }
        } catch (certError) {
          logger.warn(
            `Error loading certificate: ${
              (certError as Error).message
            }, proceeding with rejectUnauthorized=false`
          );
        }
      }

      const url = new URL(endpoint);
      const requestOptions: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: authHeader,
        },
      };

      if (url.protocol === "https:") {
        if (ca) requestOptions.ca = ca;
        requestOptions.rejectUnauthorized = rejectUnauthorized;
      }

      // Make the request to the server
      const serverResponse = await new Promise<{
        statusCode: number;
        data: any;
      }>((resolve, reject) => {
        const httpModule = url.protocol === "https:" ? https : require("http");
        const req = httpModule.request(requestOptions, (res: any) => {
          let data = "";
          res.on("data", (chunk: any) => {
            data += chunk;
          });

          res.on("end", () => {
            // Check if we got a redirect
            if (res.statusCode >= 300 && res.statusCode < 400) {
              logger.info(
                `Received redirect (${res.statusCode}) to: ${res.headers.location}`
              );
              return resolve({
                statusCode: res.statusCode,
                data: {
                  error: `Redirect received. Your API may need direct access configuration.`,
                  redirect: res.headers.location,
                },
              });
            }

            // Check content type for HTML response
            const contentType = res.headers["content-type"] || "";
            const isHtml = contentType.includes("text/html");

            if (isHtml) {
              logger.warn(
                "Received HTML response instead of JSON. This likely indicates a server configuration issue."
              );
              logger.warn(
                `Status code: ${res.statusCode}, Content-Type: ${contentType}`
              );
              logger.warn(
                "HTML content preview:",
                data.substring(0, 200) + "..."
              );

              return resolve({
                statusCode: 500,
                data: {
                  error:
                    "Received HTML response instead of JSON. Check your API server configuration.",
                },
              });
            }

            try {
              let responseData;
              if (data && data.trim()) {
                try {
                  responseData = JSON.parse(data);
                } catch (parseError) {
                  logger.error(
                    "Failed to parse response as JSON:",
                    (parseError as Error).message
                  );
                  logger.error("Response preview:", data.substring(0, 200));

                  return resolve({
                    statusCode: 500,
                    data: {
                      error: `Failed to parse server response: ${
                        (parseError as Error).message
                      }`,
                      responsePreview: data.substring(0, 200),
                    },
                  });
                }
              } else {
                responseData = {};
              }

              resolve({
                statusCode: res.statusCode || 200,
                data: responseData,
              });
            } catch (error) {
              logger.error("Error processing response:", error);
              reject(
                new Error(
                  `Failed to process response: ${(error as Error).message}`
                )
              );
            }
          });
        });

        req.on("error", (error: Error) => {
          logger.error("Network error during request:", error.message);
          reject(error);
        });

        // Send request body
        req.write(JSON.stringify(body));

        // Set request timeout
        req.setTimeout(15000, () => {
          logger.error("Request timed out after 15 seconds");
          req.destroy();
          reject(new Error("Request timed out after 15 seconds"));
        });

        req.end();
      });

      if (serverResponse.statusCode >= 400) {
        return NextResponse.json(serverResponse.data, {
          status: serverResponse.statusCode,
        });
      }

      return NextResponse.json(serverResponse.data);
    } catch (error) {
      logger.error("Error updating ticket on server:", error);
      return NextResponse.json(
        { error: `Failed to update ticket: ${(error as Error).message}` },
        { status: 500 }
      );
    }
  } catch (error) {
    logger.error("Update ticket error:", error);
    return NextResponse.json(
      { error: `Failed to update ticket: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
