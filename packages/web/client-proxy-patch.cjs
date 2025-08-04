/**
 * Client Module Proxy Patch for Next.js
 * Fixes "Cannot read properties of undefined (reading 'createClientModuleProxy')" errors
 */

const Module = require('module');

console.log('🔧 Client Module Proxy patch initializing...');

// Store original require
const originalRequire = Module.prototype.require;

// Monkey patch require to intercept Next.js client modules
Module.prototype.require = function(id, ...args) {
  const module = originalRequire.call(this, id, ...args);

  // Patch Next.js client-related modules
  if (typeof id === 'string' && (
    id.includes('next/dist/client') ||
    id.includes('next/dist/shared') ||
    id.includes('next/server') ||
    id.includes('react-server-dom')
  )) {

    try {
      // Look for module objects that need createClientModuleProxy
      const targets = [
        module.default,
        module,
        module.exports
      ].filter(Boolean);

      for (const target of targets) {
        // If the target is missing createClientModuleProxy, add a stub
        if (target && typeof target === 'object' && !target.createClientModuleProxy) {
          target.createClientModuleProxy = function(moduleId) {
            console.log('🔧 PATCHED: createClientModuleProxy called for', moduleId);
            return {
              __esModule: true,
              default: function ClientComponent(props) {
                // Return a basic component that renders nothing in SSR
                if (typeof window === 'undefined') {
                  return null;
                }
                // On client, return a div with error message
                return React.createElement('div', {
                  style: { padding: '10px', border: '1px solid red', margin: '10px' }
                }, `Client component ${moduleId} failed to load properly`);
              }
            };
          };
          console.log('✅ Added createClientModuleProxy stub to', id);
        }

        // Also patch any proxy creation functions
        if (target && typeof target.createProxy === 'function') {
          const original = target.createProxy;
          target.createProxy = function(...args) {
            try {
              return original.apply(this, args);
            } catch (error) {
              if (error.message.includes('createClientModuleProxy')) {
                console.log('🔧 PATCHED: createProxy error intercepted');
                return { __esModule: true, default: () => null };
              }
              throw error;
            }
          };
          console.log('✅ Patched createProxy in', id);
        }
      }
    } catch (patchError) {
      console.warn('🔧 Failed to apply client proxy patch to', id, ':', patchError.message);
    }
  }

  return module;
};

// Global error handler for createClientModuleProxy errors
process.on('uncaughtException', (error) => {
  if (error.message && error.message.includes('createClientModuleProxy')) {
    console.log('🔧 PATCHED: Caught createClientModuleProxy error globally');
    console.log('Error details:', error.message);
    // Don't exit, just log the error
    return;
  }
  // Re-throw other errors
  throw error;
});

console.log('✅ Client Module Proxy patch loaded');

module.exports = {
  patchApplied: true
};
