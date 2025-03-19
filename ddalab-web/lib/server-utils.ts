import https from "https";
import fs from "fs";

// Create an HTTPS agent that accepts self-signed certificates
export function createHttpsAgent() {
  // const ca = fs.readFileSync(process.env.API_SSL_CERT_PATH || "");
  // const key = fs.readFileSync(process.env.WEB_SSL_KEY_PATH || ""); // Web server's private key
  // const cert = fs.readFileSync(process.env.WEB_SSL_CERT_PATH || ""); // Web server's cert
  // console.log(process.env.API_SSL_CERT_PATH);
  // console.log(process.env.WEB_SSL_KEY_PATH);
  // console.log(process.env.WEB_SSL_CERT_PATH);

  // const httpsAgent = new https.Agent({
  //   ca, // Trust the API server's self-signed cert
  //   key, // Web server's private key
  //   cert, // Web server's certificate
  //   rejectUnauthorized: false, // Set to false for testing self-signed certs
  // });
  // return httpsAgent;
  const caPath = process.env.API_SSL_CERT_PATH;
  if (!caPath) {
    throw new Error("API_SSL_CERT_PATH environment variable is required");
  }

  const ca = fs.readFileSync(caPath); // API server's self-signed cert or its CA
  console.log("Using CA from:", caPath);

  const httpsAgent = new https.Agent({
    ca, // Trust the API server's certificate
  });
  return httpsAgent;
}
