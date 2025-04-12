import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

export function loadEnvConfig() {
  console.log(`Loading environment variables from ${path.resolve(process.cwd(), '.env')}`);
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log('Loaded .env at runtime');
  } else {
    console.warn('.env not found, falling back to process.env');
  }
}
