/**
 * @jest-environment node
 */

import { GET } from "../../app/api/route";

describe("/api route", () => {
  it("should return API information with correct structure", async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
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
  });

  it("should return NextResponse object", async () => {
    const response = await GET();

    expect(response).toBeDefined();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("should include all required endpoint information", async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.availableEndpoints).toHaveLength(4);

    // Check that each endpoint has required fields
    data.availableEndpoints.forEach((endpoint: any) => {
      expect(endpoint).toHaveProperty("path");
      expect(endpoint).toHaveProperty("description");
      expect(typeof endpoint.path).toBe("string");
      expect(typeof endpoint.description).toBe("string");
    });
  });

  it("should have correct API metadata", async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.status).toBe("ok");
    expect(data.message).toBe("DDALAB API");
    expect(data.version).toBe("1.0.0");
    expect(data.documentation).toBe("/api/documentation");
  });
});
