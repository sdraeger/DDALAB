/**
 * Webpack-level patch for createClientModuleProxy
 * This patches the webpack runtime before Next.js modules are processed
 */

// Store original Function constructor to create clean globals
const OriginalFunction = global.Function;

// Patch the webpack runtime evaluation environment
const originalEval = global.eval;
global.eval = function(code) {
  // Check if this is webpack runtime code that needs patching
  if (typeof code === 'string' && (
    code.includes('createClientModuleProxy') ||
    code.includes('react-server-dom') ||
    code.includes('__webpack_require__')
  )) {

    // Inject createClientModuleProxy stub into webpack runtime
    const patchedCode = code.replace(
      /(\w+)\.createClientModuleProxy/g,
      '(($1.createClientModuleProxy) || (function(id) { console.log("🔧 WEBPACK PATCH: createClientModuleProxy stub for", id); return { __esModule: true, default: function() { return null; } }; }))'
    );

    // Also patch direct references
    const fullyPatchedCode = patchedCode.replace(
      /createClientModuleProxy\s*\(/g,
      '((typeof createClientModuleProxy !== "undefined" ? createClientModuleProxy : function(id) { console.log("🔧 WEBPACK PATCH: createClientModuleProxy global stub for", id); return { __esModule: true, default: function() { return null; } }; })('
    );

    if (patchedCode !== code || fullyPatchedCode !== patchedCode) {
      console.log('🔧 WEBPACK PATCH: Patched createClientModuleProxy references in webpack runtime');
      return originalEval.call(this, fullyPatchedCode);
    }
  }

  return originalEval.call(this, code);
};

// Also patch Function constructor calls that webpack might use
global.Function = function(...args) {
  const code = args[args.length - 1];

  if (typeof code === 'string' && code.includes('createClientModuleProxy')) {
    const patchedCode = code.replace(
      /(\w+)\.createClientModuleProxy/g,
      '(($1.createClientModuleProxy) || (function(id) { console.log("🔧 FUNCTION PATCH: createClientModuleProxy stub for", id); return { __esModule: true, default: function() { return null; } }; }))'
    );

    if (patchedCode !== code) {
      console.log('🔧 FUNCTION PATCH: Patched createClientModuleProxy in Function constructor');
      args[args.length - 1] = patchedCode;
    }
  }

  return OriginalFunction.apply(this, args);
};

// Global createClientModuleProxy fallback
if (typeof global.createClientModuleProxy === 'undefined') {
  global.createClientModuleProxy = function(moduleId) {
    console.log('🔧 GLOBAL PATCH: createClientModuleProxy called for', moduleId);
    return {
      __esModule: true,
      default: function ClientComponentStub(props) {
        // Return null for server-side rendering
        if (typeof window === 'undefined') {
          return null;
        }
        // Return a placeholder on client-side
        return {
          $$typeof: Symbol.for('react.element'),
          type: 'div',
          props: { children: `[Client Component: ${moduleId}]` },
          key: null,
          ref: null
        };
      }
    };
  };
  console.log('✅ Global createClientModuleProxy stub installed');
}

console.log('✅ Webpack-level createClientModuleProxy patch loaded');

module.exports = {
  patchApplied: true
};
