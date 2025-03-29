import { type NextRequest, NextResponse } from "next/server";
import https from "https";
import fs from "fs";
import logger from "@/lib/utils/logger";

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
