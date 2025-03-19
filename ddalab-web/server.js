// This file is used for development to add HTTPS
const https = require("https")
const http = require("http")
const { parse } = require("url") 
const fs = require("fs")
const path = require("path")
const { createProxyServer } = require("http-proxy")
const { exec } = require("child_process")

// Get environment variables
const port = Number.parseInt(process.env.PORT || "3000", 10)
const nextDevPort = 3001 // Internal port for Next.js dev server

// Define paths to SSL certificates
const keyPath = process.env.WEB_SSL_KEY_PATH || path.join(__dirname, "certificates", "localhost-key.pem") 
const certPath = process.env.WEB_SSL_CERT_PATH || path.join(__dirname, "certificates", "localhost.pem")

// Function to sync users between SQLite and Directus
function syncDirectusUsers() {
  console.log("Running user synchronization...")
  const syncScript = path.join(__dirname, "scripts", "syncDirectusUsers.js")
  
  exec(`node ${syncScript}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`User sync error: ${error.message}`)
      return
    }
    if (stderr) {
      console.error(`User sync stderr: ${stderr}`)
      return
    }
    console.log(`User sync completed: ${stdout}`)
  })
}

// Run initial sync on server start
setTimeout(() => {
  syncDirectusUsers()
}, 10000) // Wait 10 seconds for services to start

// Schedule recurring sync every hour
setInterval(syncDirectusUsers, 60 * 60 * 1000)

// Start Next.js on internal port
const { spawn } = require("child_process")
const nextDevServer = spawn("npx", ["next", "dev", "--port", nextDevPort.toString()], {
  stdio: ["ignore", "inherit", "inherit"],
  shell: true,
})

// Log Next.js server info
console.log(`Starting Next.js dev server on internal port ${nextDevPort}...`)

// Handle process termination
process.on("SIGINT", () => {
  console.log("Shutting down servers...")
  nextDevServer.kill()
  process.exit(0)
})

// Create HTTPS proxy
let httpsOptions
try {
  httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  }
  console.log("SSL certificates loaded successfully")
} catch (err) {
  console.error("SSL certificates not found or not readable:", err.message)
  process.exit(1)
}

// Create proxy server
const proxy = createProxyServer({
  target: `http://localhost:${nextDevPort}`,
  ws: true, // Enable WebSocket proxying
  secure: false,
})

// Log proxy errors
proxy.on("error", (err, req, res) => {
  console.error("Proxy error:", err)
  res.writeHead(500, { "Content-Type": "text/plain" })
  res.end("Proxy error occurred")
})

// Handle websocket upgrade
proxy.on("proxyReqWs", (proxyReq, req, socket, options, head) => {
  console.log("Proxying WebSocket:", req.url)
})

// Create HTTPS server
const server = https.createServer(httpsOptions, (req, res) => {
  // Proxy all requests to Next.js
  proxy.web(req, res, {
    target: `http://localhost:${nextDevPort}`,
  })
})

// Handle WebSocket upgrade
server.on("upgrade", (req, socket, head) => {
  proxy.ws(req, socket, head)
})

// Start HTTPS server
server.listen(port, () => {
  console.log(`> HTTPS proxy ready on https://localhost:${port}`)
  console.log(`> Proxying to Next.js dev server on http://localhost:${nextDevPort}`)
})

