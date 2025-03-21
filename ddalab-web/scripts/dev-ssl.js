const https = require('https');
const next = require('next');
const fs = require('fs');
const path = require('path');
const { getEnvVar, getNumericEnvVar } = require('../lib/utils/env');

// Environment variables
const keyPath = getEnvVar('SSL_KEY_PATH', path.join(process.cwd(), "key.pem"));
const certPath = getEnvVar('SSL_CERT_PATH', path.join(process.cwd(), "cert.pem"));
const port = getNumericEnvVar('PORT', 3000);

// Check if certificates exist
try {
  fs.accessSync(keyPath, fs.constants.R_OK)
  fs.accessSync(certPath, fs.constants.R_OK)
} catch (err) {
  console.error("Error: SSL certificates not found.")
  console.error(`Please ensure key.pem exists at: ${keyPath}`)
  console.error(`Please ensure cert.pem exists at: ${certPath}`)
  console.error("You can set SSL_KEY_PATH and SSL_CERT_PATH environment variables to specify custom paths.")
  process.exit(1)
}

const dev = process.env.NODE_ENV !== "production"
const app = next({ dev })
const handle = app.getRequestHandler()

const httpsOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
}

app.prepare().then(() => {
  https.createServer(httpsOptions, (req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  }).listen(port, (err) => {
    if (err) throw err
    console.log(`> Ready on https://localhost:${port}`)
  })
})

