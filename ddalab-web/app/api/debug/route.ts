import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  // Get all headers for debugging
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Get URL info
  const url = new URL(request.url);

  // Return debug info
  return NextResponse.json({
    headers,
    method: request.method,
    url: request.url,
    path: url.pathname,
    cookies: request.cookies.getAll().map((c) => c.name),
    searchParams: Object.fromEntries(url.searchParams.entries()),
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  // Get all headers for debugging
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Get body if possible
  let body;
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await request.json();
    } else {
      body = await request.text();
    }
  } catch (e) {
    body = { error: "Could not parse body" };
  }

  // Get URL info
  const url = new URL(request.url);

  // Return debug info
  return NextResponse.json({
    headers,
    method: request.method,
    url: request.url,
    path: url.pathname,
    body,
    cookies: request.cookies.getAll().map((c) => c.name),
    searchParams: Object.fromEntries(url.searchParams.entries()),
    timestamp: new Date().toISOString(),
  });
}
