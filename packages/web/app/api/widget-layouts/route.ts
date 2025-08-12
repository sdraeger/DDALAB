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

export async function GET(request: NextRequest) {
  try {
    console.log("=== Widget Layouts GET Request ===");

    // Try to get token from NextAuth (cookie-based)
    let token = await getToken({ req: request });
    let accessToken = token?.accessToken as string;
    let userId = token?.sub;

    // If no NextAuth token, try Bearer token from Authorization header
    if (!token?.sub || !token.accessToken) {
      const authHeader = request.headers.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const bearerToken = authHeader.substring(7);
        // For local mode, accept the local-mode-token
        if (bearerToken === "local-mode-token") {
          accessToken = bearerToken;
          userId = "local-user";
          console.log("Using local mode authentication");
        } else {
          // For real tokens, we'd validate them here
          // For now, accept any bearer token (should be improved for production)
          accessToken = bearerToken;
          userId = "bearer-user"; // This should be extracted from token validation
          console.log("Using Bearer token authentication");
        }
      }
    }

    if (!userId || !accessToken) {
      console.warn("Unauthorized request - no valid token or bearer token");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    // Proxy to Python API
    const response = await proxyToPythonAPI(
      "/widget-layouts",
      "GET",
      accessToken
    );

    if (!response.ok) {
      if (response.status === 404) {
        console.info(
          `No layout found for user ${userId} - this is normal for new users`
        );
        return NextResponse.json(
          { error: "Layout not found" },
          { status: 404, headers: corsHeaders }
        );
      }

      const errorData = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      console.error("Python API error:", response.status, errorData);
      return NextResponse.json(
        { error: errorData.message || "Internal server error" },
        { status: response.status, headers: corsHeaders }
      );
    }

    const data = await response.json();
    console.info(`Loaded widget layout for user ${userId}`);

    return NextResponse.json(data, { headers: corsHeaders });
  } catch (error) {
    console.error("Error loading widget layout:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log("=== Widget Layouts POST Request ===");

    // Try to get token from NextAuth (cookie-based)
    let token = await getToken({ req: request });
    let accessToken = token?.accessToken as string;
    let userId = token?.sub;

    // If no NextAuth token, try Bearer token from Authorization header
    if (!token?.sub || !token.accessToken) {
      const authHeader = request.headers.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const bearerToken = authHeader.substring(7);
        // For local mode, accept the local-mode-token
        if (bearerToken === "local-mode-token") {
          accessToken = bearerToken;
          userId = "local-user";
          console.log("Using local mode authentication");
        } else {
          // For real tokens, we'd validate them here
          // For now, accept any bearer token (should be improved for production)
          accessToken = bearerToken;
          userId = "bearer-user"; // This should be extracted from token validation
          console.log("Using Bearer token authentication");
        }
      }
    }

    if (!userId || !accessToken) {
      console.warn(
        "Unauthorized request to save widget layout - no valid token or bearer token"
      );
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();

    // Log the incoming request body for debugging
    console.log("=== Incoming Widget Layout Request ===");
    console.log("Body keys:", Object.keys(body));
    console.log("Number of widgets:", body.widgets?.length || 0);
    console.log("Number of layouts:", body.layout?.length || 0);
    console.log(
      "Sample widget structure:",
      body.widgets?.[0]
        ? {
            id: body.widgets[0].id,
            type: body.widgets[0].type,
            hasLayoutInfo: !!body.widgets[0].layoutInfo,
            layoutInfoKeys: body.widgets[0].layoutInfo
              ? Object.keys(body.widgets[0].layoutInfo)
              : [],
          }
        : "No widgets"
    );

    // Validate the request body
    if (!body.layout || !body.widgets) {
      return NextResponse.json(
        { error: "Invalid request body - layout and widgets are required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Handle empty widgets case - delete the layout instead of saving empty
    if (body.widgets.length === 0) {
      console.info(
        `Empty widgets array for user ${userId}, deleting layout instead`
      );

      try {
        const deleteResponse = await proxyToPythonAPI(
          "/widget-layouts",
          "DELETE",
          accessToken
        );

        return NextResponse.json(
          {
            success: true,
            data: {
              status: "success",
              message: "No widgets to save - layout cleared",
            },
          },
          { headers: corsHeaders }
        );
      } catch (error) {
        console.warn(`Error handling empty layout for user ${userId}:`, error);
        return NextResponse.json(
          {
            success: true,
            data: {
              status: "success",
              message: "No widgets to save",
            },
          },
          { headers: corsHeaders }
        );
      }
    }

    // Transform the layout data to match the backend schema
    const pythonAPIPayload = {
      widgets: body.widgets
        .map((widget: any) => {
          if (!widget.id || !widget.type) {
            console.warn(`Invalid widget data for user ${userId}:`, widget);
            return null;
          }

          // First try to get position/size from widget.layoutInfo (new format)
          let position, size, minSize, maxSize;

          if (widget.layoutInfo) {
            // New format with embedded layoutInfo
            position = {
              x: widget.layoutInfo.x || 0,
              y: widget.layoutInfo.y || 0,
            };
            size = {
              width: widget.layoutInfo.w || 4,
              height: widget.layoutInfo.h || 3,
            };
            minSize = widget.layoutInfo.minW
              ? {
                  width: widget.layoutInfo.minW,
                  height: widget.layoutInfo.minH || 1,
                }
              : undefined;
            maxSize = widget.layoutInfo.maxW
              ? {
                  width: widget.layoutInfo.maxW,
                  height: widget.layoutInfo.maxH || 100,
                }
              : undefined;
          } else {
            // Fallback: try to find corresponding layout for this widget (old format)
            const layout = body.layout?.find((l: any) => l.i === widget.id);
            if (layout) {
              position = { x: layout.x, y: layout.y };
              size = { width: layout.w, height: layout.h };
              minSize = layout.minW
                ? { width: layout.minW, height: layout.minH || 1 }
                : undefined;
              maxSize = layout.maxW
                ? { width: layout.maxW, height: layout.maxH || 100 }
                : undefined;
            } else {
              // Last resort: Use constraints if available, otherwise defaults
              const constraints = widget.constraints || {};
              position = { x: 0, y: 0 };
              size = {
                width: constraints.minW || 4,
                height: constraints.minH || 3,
              };
              minSize = constraints.minW
                ? { width: constraints.minW, height: constraints.minH || 1 }
                : undefined;
              maxSize = constraints.maxW
                ? { width: constraints.maxW, height: constraints.maxH || 100 }
                : undefined;
            }
          }

          return {
            id: widget.id,
            title: widget.title || "Untitled Widget",
            type: widget.type,
            metadata: widget.metadata || {},
            constraints: widget.constraints || {},
            position,
            size,
            minSize,
            maxSize,
          };
        })
        .filter(Boolean), // Remove null entries
    };

    // Log the transformed payload for debugging
    console.log("=== Transformed Payload ===");
    console.log(
      "Number of widgets after transformation:",
      pythonAPIPayload.widgets.length
    );
    console.log(
      "Sample transformed widget:",
      pythonAPIPayload.widgets[0]
        ? {
            id: pythonAPIPayload.widgets[0].id,
            type: pythonAPIPayload.widgets[0].type,
            hasPosition: !!pythonAPIPayload.widgets[0].position,
            hasSize: !!pythonAPIPayload.widgets[0].size,
            position: pythonAPIPayload.widgets[0].position,
            size: pythonAPIPayload.widgets[0].size,
          }
        : "No widgets after transformation"
    );

    // Double-check that we have widgets after transformation
    if (pythonAPIPayload.widgets.length === 0) {
      console.warn(
        `No valid widgets after transformation for user ${userId}, treating as empty layout`
      );

      try {
        const deleteResponse = await proxyToPythonAPI(
          "/widget-layouts",
          "DELETE",
          accessToken
        );

        return NextResponse.json(
          {
            success: true,
            data: {
              status: "success",
              message: "No valid widgets after transformation",
            },
          },
          { headers: corsHeaders }
        );
      } catch (error) {
        console.warn(
          `Error handling empty transformed layout for user ${userId}:`,
          error
        );
        return NextResponse.json(
          {
            success: true,
            data: {
              status: "success",
              message: "No valid widgets after transformation",
            },
          },
          { headers: corsHeaders }
        );
      }
    }

    // Proxy to Python API
    const response = await proxyToPythonAPI(
      "/widget-layouts",
      "POST",
      accessToken,
      pythonAPIPayload
    );

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      console.error("Python API error:", response.status, errorData);
      return NextResponse.json(
        { error: errorData.message || "Failed to save layout" },
        { status: response.status, headers: corsHeaders }
      );
    }

    const result = await response.json();
    console.info(`Saved widget layout for user ${userId} to database`);

    return NextResponse.json(
      { success: true, data: result },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Error saving widget layout:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    console.log("=== Widget Layouts DELETE Request ===");

    // Try to get token from NextAuth (cookie-based)
    let token = await getToken({ req: request });
    let accessToken = token?.accessToken as string;
    let userId = token?.sub;

    // If no NextAuth token, try Bearer token from Authorization header
    if (!token?.sub || !token.accessToken) {
      const authHeader = request.headers.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const bearerToken = authHeader.substring(7);
        // For local mode, accept the local-mode-token
        if (bearerToken === "local-mode-token") {
          accessToken = bearerToken;
          userId = "local-user";
          console.log("Using local mode authentication");
        } else {
          // For real tokens, we'd validate them here
          // For now, accept any bearer token (should be improved for production)
          accessToken = bearerToken;
          userId = "bearer-user"; // This should be extracted from token validation
          console.log("Using Bearer token authentication");
        }
      }
    }

    if (!userId || !accessToken) {
      console.warn(
        "Unauthorized request to delete widget layout - no valid token or bearer token"
      );
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    // Proxy to Python API
    const response = await proxyToPythonAPI(
      "/widget-layouts",
      "DELETE",
      accessToken
    );

    if (!response.ok) {
      if (response.status === 404) {
        console.info(
          `No layout found to delete for user ${userId} - this is okay`
        );
        return NextResponse.json(
          {
            success: true,
            data: {
              status: "success",
              message: "No layout found to delete",
            },
          },
          { headers: corsHeaders }
        );
      }

      const errorData = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      console.error("Python API error:", response.status, errorData);
      return NextResponse.json(
        { error: errorData.message || "Failed to delete layout" },
        { status: response.status, headers: corsHeaders }
      );
    }

    const result = await response.json();
    console.info(`Deleted widget layout for user ${userId}`);

    return NextResponse.json(
      { success: true, data: result },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Error deleting widget layout:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function HEAD(request: NextRequest) {
  try {
    // Try to get token from NextAuth (cookie-based)
    let token = await getToken({ req: request });
    let accessToken = token?.accessToken as string;
    let userId = token?.sub;

    // If no NextAuth token, try Bearer token from Authorization header
    if (!token?.sub || !token.accessToken) {
      const authHeader = request.headers.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const bearerToken = authHeader.substring(7);
        // For local mode, accept the local-mode-token
        if (bearerToken === "local-mode-token") {
          accessToken = bearerToken;
          userId = "local-user";
        } else {
          // For real tokens, we'd validate them here
          // For now, accept any bearer token (should be improved for production)
          accessToken = bearerToken;
          userId = "bearer-user"; // This should be extracted from token validation
        }
      }
    }

    if (!userId || !accessToken) {
      return new NextResponse(null, { status: 401, headers: corsHeaders });
    }

    // Proxy to Python API
    const response = await proxyToPythonAPI(
      "/widget-layouts",
      "GET",
      accessToken
    );

    return new NextResponse(null, {
      status: response.status,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("Error checking widget layout:", error);
    return new NextResponse(null, { status: 500, headers: corsHeaders });
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}
