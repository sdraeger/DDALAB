/**
 * Advanced Next.js Filter Error Patch
 * Patches the getinterceptionRoutePatterns function to handle undefined arrays
 */

const Module = require("module");
const path = require("path");

let patchApplied = false;

// Store original require
const originalRequire = Module.prototype.require;

console.log("🔧 Advanced Next.js patch initializing...");

// More aggressive patching - patch the Module.require directly
Module.prototype.require = function (id, ...args) {
  const module = originalRequire.call(this, id, ...args);

  // Patch any Next.js server-related modules
  if (
    typeof id === "string" &&
    (id.includes("next/dist/server") ||
      id.includes("next-server") ||
      id.endsWith("/next.js") ||
      id.endsWith("next-server.js") ||
      id.includes("next/dist/server/next-server"))
  ) {
    try {
      // Look for any class or object that has the problematic method
      const targets = [
        module.NextNodeServer,
        module.default?.NextNodeServer,
        module.NextServer,
        module.default?.NextServer,
        module.default,
        module,
      ].filter(Boolean);

      for (const target of targets) {
        if (
          target &&
          target.prototype &&
          target.prototype.getinterceptionRoutePatterns
        ) {
          const original = target.prototype.getinterceptionRoutePatterns;

          target.prototype.getinterceptionRoutePatterns = function () {
            try {
              const result = original.call(this);
              // Ensure we always return an array
              if (Array.isArray(result)) {
                return result;
              }
              console.log(
                "🔧 PATCHED: getinterceptionRoutePatterns returned non-array, converting to empty array"
              );
              return [];
            } catch (error) {
              if (
                error.message.includes(
                  "Cannot read properties of undefined (reading 'filter')"
                )
              ) {
                console.log(
                  "🔧 PATCHED: Next.js filter error intercepted in",
                  id
                );
                return [];
              }
              console.warn(
                "🔧 Next.js patch - unexpected error in",
                id,
                ":",
                error.message
              );
              return [];
            }
          };

          console.log(
            "✅ Successfully patched getinterceptionRoutePatterns in",
            id
          );
          patchApplied = true;
        }

        // Also patch direct method if it exists on the object
        if (
          target &&
          typeof target.getinterceptionRoutePatterns === "function"
        ) {
          const original = target.getinterceptionRoutePatterns;

          target.getinterceptionRoutePatterns = function () {
            try {
              const result = original.call(this);
              // Ensure we always return an array
              if (Array.isArray(result)) {
                return result;
              }
              console.log(
                "🔧 PATCHED: getinterceptionRoutePatterns (direct) returned non-array, converting to empty array"
              );
              return [];
            } catch (error) {
              if (
                error.message.includes(
                  "Cannot read properties of undefined (reading 'filter')"
                )
              ) {
                console.log(
                  "🔧 PATCHED: Next.js filter error intercepted (direct method) in",
                  id
                );
                return [];
              }
              console.warn(
                "🔧 Next.js patch - unexpected error (direct method) in",
                id,
                ":",
                error.message
              );
              return [];
            }
          };

          console.log(
            "✅ Successfully patched direct getinterceptionRoutePatterns method in",
            id
          );
          patchApplied = true;
        }
      }
    } catch (patchError) {
      console.warn(
        "🔧 Failed to apply Next.js patch to",
        id,
        ":",
        patchError.message
      );
    }
  }

  return module;
};

// Also try to patch any already loaded Next.js modules
function patchLoadedModules() {
  const loadedModules = Object.keys(require.cache);

  for (const modulePath of loadedModules) {
    if (
      (modulePath.includes("next-server") ||
        modulePath.includes("next/dist/server/next") ||
        modulePath.includes("next/dist/server/next-server")) &&
      !patchApplied
    ) {
      try {
        const module = require.cache[modulePath];
        if (module && module.exports) {
          const exports = module.exports;
          const serverClass =
            exports.NextNodeServer ||
            exports.default?.NextNodeServer ||
            exports.NextServer ||
            exports.default?.NextServer;

          if (
            serverClass &&
            serverClass.prototype &&
            serverClass.prototype.getinterceptionRoutePatterns
          ) {
            const original = serverClass.prototype.getinterceptionRoutePatterns;

            serverClass.prototype.getinterceptionRoutePatterns = function () {
              try {
                const result = original.call(this);
                // Ensure we always return an array
                if (Array.isArray(result)) {
                  return result;
                }
                console.log(
                  "🔧 PATCHED: getinterceptionRoutePatterns (cached) returned non-array, converting to empty array"
                );
                return [];
              } catch (error) {
                if (
                  error.message.includes(
                    "Cannot read properties of undefined (reading 'filter')"
                  )
                ) {
                  console.log(
                    "🔧 PATCHED: Next.js filter error intercepted (cached module)"
                  );
                  return [];
                }
                console.warn(
                  "🔧 Next.js patch - unexpected error (cached):",
                  error.message
                );
                return [];
              }
            };

            console.log(
              "✅ Successfully patched cached Next.js module:",
              modulePath
            );
            patchApplied = true;
            break;
          }
        }
      } catch (error) {
        // Ignore errors when patching cached modules
      }
    }
  }
}

// Try to patch already loaded modules
patchLoadedModules();

// Also try to patch Next.js after it's required
const originalNext = require("next");
if (originalNext && typeof originalNext === "function") {
  const originalCreateServer = originalNext.prototype?.createServer;
  if (originalCreateServer) {
    originalNext.prototype.createServer = function (...args) {
      try {
        const server = originalCreateServer.apply(this, args);
        // Patch the server instance if it has the problematic method
        if (server && server.getinterceptionRoutePatterns) {
          const original = server.getinterceptionRoutePatterns;
          server.getinterceptionRoutePatterns = function () {
            try {
              const result = original.call(this);
              // Ensure we always return an array
              if (Array.isArray(result)) {
                return result;
              }
              console.log(
                "🔧 PATCHED: getinterceptionRoutePatterns (server) returned non-array, converting to empty array"
              );
              return [];
            } catch (error) {
              if (
                error.message.includes(
                  "Cannot read properties of undefined (reading 'filter')"
                )
              ) {
                console.log(
                  "🔧 PATCHED: Next.js filter error intercepted at server level"
                );
                return [];
              }
              throw error;
            }
          };
          console.log(
            "✅ Successfully patched server instance getinterceptionRoutePatterns"
          );
          patchApplied = true;
        }
        return server;
      } catch (error) {
        console.warn("🔧 Error in createServer patch:", error.message);
        return originalCreateServer.apply(this, args);
      }
    };
  }
}

// Export a function to manually trigger patching if needed
module.exports = {
  isPatchApplied: () => patchApplied,
  forcePatch: patchLoadedModules,
};
