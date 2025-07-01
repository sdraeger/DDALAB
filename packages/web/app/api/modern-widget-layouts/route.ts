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
    console.log("=== Modern Widget Layouts GET Request ===");

    const token = await getToken({ req: request });

    if (!token?.sub || !token.accessToken) {
      console.warn("Unauthorized request - no valid token");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    // Proxy to Python API
    const response = await proxyToPythonAPI(
      "/widget-layouts",
      "GET",
      token.accessToken as string
    );

    if (!response.ok) {
      if (response.status === 404) {
        console.info(
          `No layout found for user ${token.sub} - this is normal for new users`
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
    console.info(`Loaded modern widget layout for user ${token.sub}`);

    // Transform Python API response to expected format
    const transformedWidgets = data.widgets.map((widget: any) => ({
      id: widget.id,
      title: widget.title,
      type: widget.type,
      metadata: widget.metadata || {},
      constraints: widget.constraints || {},
      layoutInfo: {
        x: widget.position?.x || 0,
        y: widget.position?.y || 0,
        w: widget.size?.width || 4,
        h: widget.size?.height || 3,
        minW: widget.minSize?.width,
        maxW: widget.maxSize?.width,
        minH: widget.minSize?.height,
        maxH: widget.maxSize?.height,
      },
    }));

    const layoutData = {
      layout: transformedWidgets.map((widget: any) => ({
        i: widget.id,
        x: widget.layoutInfo.x,
        y: widget.layoutInfo.y,
        w: widget.layoutInfo.w,
        h: widget.layoutInfo.h,
        minW: widget.layoutInfo.minW,
        maxW: widget.layoutInfo.maxW,
        minH: widget.layoutInfo.minH,
        maxH: widget.layoutInfo.maxH,
      })),
      widgets: transformedWidgets,
      version: "2.1",
      timestamp: Date.now(),
    };

    console.log(
      "Transformed response for frontend:",
      JSON.stringify(layoutData, null, 2)
    );

    return NextResponse.json(layoutData, { headers: corsHeaders });
  } catch (error) {
    console.error("Error loading modern widget layout:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request });

    if (!token?.sub || !token.accessToken) {
      console.warn("Unauthorized request to save modern widget layout");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();

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
        `Empty widgets array for user ${token.sub}, deleting layout instead`
      );

      try {
        const deleteResponse = await proxyToPythonAPI(
          "/widget-layouts",
          "DELETE",
          token.accessToken as string
        );

        if (deleteResponse.ok || deleteResponse.status === 404) {
          console.info(
            `Successfully handled empty layout for user ${token.sub}`
          );
          return NextResponse.json(
            {
              success: true,
              data: { status: "success", message: "Empty layout handled" },
            },
            { headers: corsHeaders }
          );
        } else {
          console.warn(
            `Failed to delete empty layout for user ${token.sub}:`,
            deleteResponse.status
          );
          // Even if delete fails, return success for empty layout to avoid error loops
          return NextResponse.json(
            {
              success: true,
              data: { status: "success", message: "Empty layout handled" },
            },
            { headers: corsHeaders }
          );
        }
      } catch (error) {
        console.warn(
          `Error handling empty layout for user ${token.sub}:`,
          error
        );
        // Return success even on error to avoid infinite error loops with empty layouts
        return NextResponse.json(
          {
            success: true,
            data: { status: "success", message: "Empty layout handled" },
          },
          { headers: corsHeaders }
        );
      }
    }

    // Transform request for Python API
    const pythonAPIPayload = {
      widgets: body.widgets
        .map((widget: any) => {
          const layoutItem =
            widget.layoutInfo ||
            body.layout.find((l: any) => l.i === widget.id);

          if (!layoutItem) {
            console.warn(`No layout info found for widget ${widget.id}`);
            return null;
          }

          return {
            id: widget.id,
            title: widget.title,
            type: widget.type || "unknown",
            position: {
              x: layoutItem.x || 0,
              y: layoutItem.y || 0,
            },
            size: {
              width: layoutItem.w || 4,
              height: layoutItem.h || 3,
            },
            minSize:
              layoutItem.minW || layoutItem.minH
                ? {
                    width: layoutItem.minW || 2,
                    height: layoutItem.minH || 2,
                  }
                : undefined,
            maxSize:
              layoutItem.maxW || layoutItem.maxH
                ? {
                    width: layoutItem.maxW || 12,
                    height: layoutItem.maxH || 10,
                  }
                : undefined,
            isPopOut: false,
          };
        })
        .filter(Boolean), // Remove null entries
    };

    console.log(
      "Transformed payload for Python API:",
      JSON.stringify(pythonAPIPayload, null, 2)
    );

    // Double-check that we have widgets after transformation
    if (pythonAPIPayload.widgets.length === 0) {
      console.warn(
        `No valid widgets after transformation for user ${token.sub}, treating as empty layout`
      );

      try {
        const deleteResponse = await proxyToPythonAPI(
          "/widget-layouts",
          "DELETE",
          token.accessToken as string
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
          `Error handling empty transformed layout for user ${token.sub}:`,
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
      token.accessToken as string,
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
    console.info(
      `Saved modern widget layout for user ${token.sub} to database`
    );

    return NextResponse.json(
      { success: true, data: result },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Error saving modern widget layout:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const token = await getToken({ req: request });

    if (!token?.sub || !token.accessToken) {
      console.warn("Unauthorized request to delete modern widget layout");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    // Proxy to Python API
    const response = await proxyToPythonAPI(
      "/widget-layouts",
      "DELETE",
      token.accessToken as string
    );

    if (!response.ok) {
      if (response.status === 404) {
        console.info(`No layout to delete for user ${token.sub}`);
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
        { error: errorData.message || "Failed to delete layout" },
        { status: response.status, headers: corsHeaders }
      );
    }

    const result = await response.json();
    console.info(
      `Deleted modern widget layout for user ${token.sub} from database`
    );

    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    console.error("Error deleting modern widget layout:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function HEAD(request: NextRequest) {
  try {
    const token = await getToken({ req: request });

    if (!token?.sub || !token.accessToken) {
      return new NextResponse(null, { status: 401, headers: corsHeaders });
    }

    // Proxy to Python API
    const response = await proxyToPythonAPI(
      "/widget-layouts",
      "GET",
      token.accessToken as string
    );

    return new NextResponse(null, {
      status: response.status,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("Error checking modern widget layout:", error);
    return new NextResponse(null, { status: 500, headers: corsHeaders });
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}
