#!/usr/bin/env node

/**
 * Debug server for Next.js filter error
 * Bypasses the problematic getinterceptionRoutePatterns function
 */

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000');

console.log('🐛 Starting DEBUG server to bypass Next.js filter error...');
console.log(`Environment: ${dev ? 'development' : 'production'}`);
console.log(`Server will listen on: http://${hostname}:${port}`);

// Monkey patch the problematic function before Next.js loads
const originalRequire = require;
require = function(id) {
  const module = originalRequire.apply(this, arguments);

  // Intercept Next.js server module and patch the filter error
  if (id.includes('next/dist/server/next-server') || id.includes('next-server')) {
    if (module.NextNodeServer && module.NextNodeServer.prototype.getinterceptionRoutePatterns) {
      const original = module.NextNodeServer.prototype.getinterceptionRoutePatterns;
      module.NextNodeServer.prototype.getinterceptionRoutePatterns = function() {
        try {
          return original.call(this);
        } catch (error) {
          console.warn('🔧 Patched Next.js filter error:', error.message);
          // Return empty array instead of crashing
          return [];
        }
      };
      console.log('✅ Successfully patched getinterceptionRoutePatterns');
    }
  }

  return module;
};

// Now initialize Next.js
const app = next({
  dev,
  hostname,
  port,
  // Force disable some problematic features
  experimental: {
    // Disable features that might cause issues
  }
});

const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  }).listen(port, hostname, (err) => {
    if (err) throw err;
    console.log(`🚀 DEBUG server ready on http://${hostname}:${port}`);
  });
}).catch(err => {
  console.error('❌ Failed to start DEBUG server:', err);
  process.exit(1);
});
