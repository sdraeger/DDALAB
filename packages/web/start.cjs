const dotenv = require('dotenv');
const { createServer } = require('http');
const { join } = require('path');
const fs = require('fs');

// Load environment variables
const envPath = join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
  console.log('Loaded .env from:', envPath);
} else {
  console.warn('.env not found at:', envPath);
}

// Debug environment variables
console.log('Environment debug:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('NEXT_PUBLIC_API_URL:', process.env.NEXT_PUBLIC_API_URL);

// Load Next.js
const next = require('next');

// Create Next.js app instance
const app = next({
  dev: false, // Production mode
  dir: __dirname,
  port: 3000, // Match EXPOSE in Dockerfile
});

// Get the request handler
const handle = app.getRequestHandler();

// Prepare and start the app
app.prepare().then(() => {
  console.log('🚀 Next.js app prepared successfully');
  
  // Create an HTTP server
  const server = createServer((req, res) => {
    handle(req, res);
  });

  // Start listening on port 3000
  server.listen(3000, (err) => {
    if (err) throw err;
    console.log('✅ Next.js app started successfully on http://0.0.0.0:3000');
  });
}).catch(err => {
  console.error('❌ Error starting Next.js:', err);
  console.error('Error stack:', err.stack);
  console.error('Error name:', err.name);
  console.error('Error message:', err.message);
  if (err.cause) {
    console.error('Error cause:', err.cause);
  }
  
  process.exit(1);
});
