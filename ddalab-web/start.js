const dotenv = require('dotenv');
const next = require('next');
const { createServer } = require('http');
const { join } = require('path');
const fs = require('fs');

// Load .env from /app/.env if provided by the user
// dotenv.config({ path: join(__dirname, '.env'), override: true });

const envPath = join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
  console.log('Loaded .env from:', envPath);
  console.log('INSTITUTION_NAME:', process.env.INSTITUTION_NAME);
} else {
  console.warn('.env not found at:', envPath);
}

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
  // Create an HTTP server
  const server = createServer((req, res) => {
    handle(req, res);
  });

  // Start listening on port 3000
  server.listen(3000, (err) => {
    if (err) throw err;
    console.log('Next.js app started on http://0.0.0.0:3000');
  });
}).catch(err => {
  console.error('Error starting Next.js:', err);
  process.exit(1);
});
