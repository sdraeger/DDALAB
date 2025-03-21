#!/usr/bin/env node
/**
 * This script syncs users between the SQLite database and Directus
 * It can be run manually or via cron job
 */

import { request } from 'https';
import { existsSync, readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getEnvVar } from '../lib/utils/env.ts';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

// Configuration
const API_URL = getEnvVar('API_URL', 'https://localhost:8001');
const API_KEY = getEnvVar('API_KEY', ''); // Admin API key for authentication
const SYNC_ENDPOINT = '/api/tickets/sync-users';
const SSL_CERT_PATH = getEnvVar('API_SSL_CERT_PATH', join(__dirname, '../certificates/localhost.pem'));

/**
 * Make an authenticated request to the API
 */
async function callSyncEndpoint() {
  return new Promise((resolve, reject) => {
    const url = `${API_URL}${SYNC_ENDPOINT}`;
    console.log(`Calling sync endpoint: ${url}`);

    // Prepare request options
    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
    };

    // Add SSL certificate for HTTPS
    if (url.startsWith('https://')) {
      try {
        if (existsSync(SSL_CERT_PATH)) {
          options.ca = readFileSync(SSL_CERT_PATH);
          console.log('SSL certificate loaded successfully');
        } else {
          console.warn(`SSL certificate not found at ${SSL_CERT_PATH}, proceeding without it`);
          options.rejectUnauthorized = false;
        }
      } catch (error) {
        console.warn(`Error loading certificate: ${error.message}, proceeding without it`);
        options.rejectUnauthorized = false;
      }
    }

    // Make the request
    const req = request(url, options, (res) => {
      let data = '';

      // Collect data chunks
      res.on('data', (chunk) => {
        data += chunk;
      });

      // Process complete response
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('User synchronization successful');
          try {
            const response = JSON.parse(data);
            resolve(response);
          } catch (error) {
            console.error('Error parsing response:', error.message);
            resolve({ message: 'Sync completed but response parsing failed' });
          }
        } else {
          console.error(`Sync failed with status code: ${res.statusCode}`);
          try {
            const errorResponse = JSON.parse(data);
            reject(new Error(`Sync failed: ${errorResponse.detail || errorResponse.message || 'Unknown error'}`));
          } catch (error) {
            reject(new Error(`Sync failed with status ${res.statusCode}`));
          }
        }
      });
    });

    // Handle request errors
    req.on('error', (error) => {
      console.error('Request error:', error.message);
      reject(new Error(`Request failed: ${error.message}`));
    });

    // Set timeout
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timed out after 10 seconds'));
    });

    // Complete the request
    req.end();
  });
}

/**
 * Main function
 */
async function main() {
  try {
    const result = await callSyncEndpoint();
    console.log('Sync result:', result);
    process.exit(0);
  } catch (error) {
    console.error('Sync error:', error.message);
    process.exit(1);
  }
}

// Run the sync
main();
