import { Pool } from "pg";

// Create a new pool instance
export const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: parseInt(process.env.POSTGRES_PORT || "5432"),
  ssl:
    process.env.POSTGRES_SSL === "true"
      ? { rejectUnauthorized: false }
      : undefined,
});
