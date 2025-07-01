import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { promises as fs } from "fs";
import path from "path";

// CORS headers for development to allow requests from Traefik proxy
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://localhost",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
  "Access-Control-Allow-Credentials": "true",
};

// File-based storage for development - in production, this would use a database
const STORAGE_DIR = path.join(process.cwd(), ".next", "dev-storage");
const LAYOUT_FILE = path.join(STORAGE_DIR, "modern-layouts.json");

// Ensure storage directory exists
async function ensureStorageDir() {
  try {
    await fs.access(STORAGE_DIR);
  } catch {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
  }
}

// Load layouts from file
async function loadLayouts(): Promise<Map<string, any>> {
  try {
    await ensureStorageDir();
    const data = await fs.readFile(LAYOUT_FILE, "utf8");
    const parsed = JSON.parse(data);
    return new Map(Object.entries(parsed));
  } catch {
    // File doesn't exist or is invalid, return empty map
    return new Map();
  }
}

// Save layouts to file
async function saveLayouts(layouts: Map<string, any>): Promise<void> {
  try {
    await ensureStorageDir();
    const data = Object.fromEntries(layouts);
    await fs.writeFile(LAYOUT_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Error saving layouts to file:", error);
  }
}

export async function GET(request: NextRequest) {
  try {
    // Debug logging for authentication troubleshooting
    console.log("=== DEBUG: Modern Widget Layouts GET Request ===");
    console.log("Request URL:", request.url);
    console.log(
      "Request headers:",
      Object.fromEntries(request.headers.entries())
    );
    console.log(
      "Request cookies:",
      request.cookies
        .getAll()
        .map((c) => ({ name: c.name, value: c.value.substring(0, 20) + "..." }))
    );

    const token = await getToken({ req: request });
    console.log(
      "getToken result:",
      token ? { sub: token.sub, name: token.name, exp: token.exp } : "null"
    );

    if (!token?.sub) {
      console.warn(
        "Unauthorized request to load modern widget layout - no valid token"
      );
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    const userId = token.sub;
    const layouts = await loadLayouts();
    const layoutData = layouts.get(`modern-layout-${userId}`);

    if (!layoutData) {
      console.info(
        `No modern widget layout found for user ${userId} - this is normal for new users`
      );
      return NextResponse.json(
        { error: "Layout not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    console.info(`Loaded modern widget layout for user ${userId}`);
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

    if (!token?.sub) {
      console.warn("Unauthorized request to save modern widget layout");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    const userId = token.sub;
    const body = await request.json();

    // Validate the request body
    if (!body.layout || !body.widgets) {
      return NextResponse.json(
        { error: "Invalid request body - layout and widgets are required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Store the layout (in production, this would save to database)
    const layoutData = {
      ...body,
      userId,
      updatedAt: new Date().toISOString(),
    };

    const layouts = await loadLayouts();
    layouts.set(`modern-layout-${userId}`, layoutData);
    await saveLayouts(layouts);

    console.info(`Saved modern widget layout for user ${userId}`);
    return NextResponse.json(
      { success: true, data: layoutData },
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

    if (!token?.sub) {
      console.warn("Unauthorized request to delete modern widget layout");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    const userId = token.sub;
    const layouts = await loadLayouts();
    const layoutExists = layouts.has(`modern-layout-${userId}`);

    if (!layoutExists) {
      console.info(`No modern widget layout to delete for user ${userId}`);
      return NextResponse.json(
        { error: "Layout not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    layouts.delete(`modern-layout-${userId}`);
    await saveLayouts(layouts);

    console.info(`Deleted modern widget layout for user ${userId}`);
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

    if (!token?.sub) {
      return new NextResponse(null, { status: 401, headers: corsHeaders });
    }

    const userId = token.sub;
    const layouts = await loadLayouts();
    const layoutExists = layouts.has(`modern-layout-${userId}`);

    return new NextResponse(null, {
      status: layoutExists ? 200 : 404,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("Error checking modern widget layout:", error);
    return new NextResponse(null, { status: 500, headers: corsHeaders });
  }
}

// Handle CORS preflight requests
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}
