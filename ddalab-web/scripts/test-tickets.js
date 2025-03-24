const fs = require("fs");
// Simple test script for tickets endpoint
const https = require("https");
const path = require("path");

// Disable SSL verification for testing
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Test with a mock token
const mockToken = "test-token";

// Make the request
const options = {
  hostname: "localhost",
  port: 443,
  path: "/api/tickets",
  method: "GET",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${mockToken}`,
  },
};

console.log(
  "Sending request to:",
  `https://${options.hostname}:${options.port}${options.path}`
);

const req = https.request(options, (res) => {
  console.log("Status Code:", res.statusCode);
  console.log("Headers:", res.headers);

  let data = "";
  res.on("data", (chunk) => {
    data += chunk;
  });

  res.on("end", () => {
    console.log("Response Body:", data);

    try {
      const jsonData = JSON.parse(data);
      console.log("Parsed JSON:", jsonData);
    } catch (err) {
      console.error("Error parsing JSON:", err.message);
    }
  });
});

req.on("error", (error) => {
  console.error("Error:", error);
});

req.end();
