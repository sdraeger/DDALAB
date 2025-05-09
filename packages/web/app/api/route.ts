import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    message: "DDALAB API",
    version: "1.0.0",
    documentation: "/api/documentation",
    availableEndpoints: [
      {
        path: "/api/auth",
        description: "Authentication endpoints",
      },
      {
        path: "/api/tickets",
        description: "Help ticket management",
      },
      {
        path: "/api/graphql",
        description: "GraphQL API",
      },
      {
        path: "/api/proxy",
        description: "API proxy for remote services",
      },
    ],
  });
}
