/**
 * @jest-environment node
 */

describe("Next.js Configuration", () => {
  describe("Environment Variables", () => {
    it("should have test environment variables set", () => {
      expect(process.env.NODE_ENV).toBe("test");
      expect(process.env.API_URL).toBe("http://localhost:8001");
      // Public env is optional at runtime; server-side API_URL is primary
      expect(process.env.NEXT_PUBLIC_API_URL).toBe("http://localhost:8001");
      expect(process.env.SESSION_EXPIRATION).toBe("30");
    });
  });

  describe("URL Configuration", () => {
    const validateUrl = (url: string): boolean => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    };

    it("should have valid API URL format", () => {
      const apiUrl = process.env.API_URL || "";
      expect(validateUrl(apiUrl)).toBe(true);
      expect(apiUrl).toMatch(/^https?:\/\//);
    });

    it("should have a valid private API URL configured", () => {
      expect(process.env.API_URL).toMatch(/^https?:\/\//);
    });
  });

  describe("Route Patterns", () => {
    const isApiRoute = (path: string): boolean => {
      return path.startsWith("/api/");
    };

    const isProtectedRoute = (path: string): boolean => {
      const protectedPatterns = [
        "/dashboard",
        "/api/tickets",
        "/api/data",
        "/api/analysis",
      ];
      return protectedPatterns.some((pattern) => path.startsWith(pattern));
    };

    it("should identify API routes correctly", () => {
      expect(isApiRoute("/api/auth")).toBe(true);
      expect(isApiRoute("/api/tickets")).toBe(true);
      expect(isApiRoute("/dashboard")).toBe(false);
      expect(isApiRoute("/login")).toBe(false);
    });

    it("should identify protected routes correctly", () => {
      expect(isProtectedRoute("/dashboard")).toBe(true);
      expect(isProtectedRoute("/dashboard/settings")).toBe(true);
      expect(isProtectedRoute("/api/tickets")).toBe(true);
      expect(isProtectedRoute("/login")).toBe(false);
      expect(isProtectedRoute("/api/auth")).toBe(false);
    });
  });

  describe("Application Metadata", () => {
    const appMetadata = {
      name: "DDALAB - EEG Data Visualization",
      description: "Visualize and analyze EEG data in your browser",
      version: "1.0.0",
    };

    it("should have proper application metadata", () => {
      expect(appMetadata.name).toBeTruthy();
      expect(appMetadata.description).toBeTruthy();
      expect(appMetadata.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("should have descriptive application name", () => {
      expect(appMetadata.name).toContain("DDALAB");
      expect(appMetadata.name).toContain("EEG");
    });
  });
});
