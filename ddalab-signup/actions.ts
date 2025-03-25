"use server";

import { revalidatePath } from "next/cache";
import { rateLimit } from "./lib/rate-limit";
import { pool } from "./lib/db/pool";

type SignupData = {
  firstName: string;
  lastName: string;
  affiliation: string;
  email: string;
};

// Function to check if a user already exists in the database
async function checkUserExists(
  email: string,
  firstName: string,
  lastName: string
): Promise<boolean> {
  try {
    const query = `
      SELECT id FROM signup_requests 
      WHERE email = $1 
      OR (first_name = $2 AND last_name = $3)
    `;

    console.log(
      `Checking if user already exists: ${email} or ${firstName} ${lastName}`
    );

    const result = await pool.query(query, [email, firstName, lastName]);
    const exists = result.rowCount ? result.rowCount > 0 : false;

    if (exists) {
      console.log(
        `Found existing user request: ${email} or ${firstName} ${lastName}`
      );
    } else {
      console.log(
        `User request not found: ${email} or ${firstName} ${lastName}`
      );
    }

    return exists;
  } catch (error) {
    console.error("Error checking if user exists:", error);
    throw error;
  }
}

export async function submitSignupForm(data: SignupData) {
  const rateLimitKey = data.email;

  // Apply rate limiting
  const rateLimitResult = await rateLimit(rateLimitKey);
  if (!rateLimitResult.success) {
    return {
      success: false,
      error: `Rate limit exceeded. Try again after ${rateLimitResult.retryAfter} seconds.`,
    };
  }

  try {
    // Check if user already exists
    const userExists = await checkUserExists(
      data.email,
      data.firstName,
      data.lastName
    );

    // If user exists, return early with an error
    if (userExists) {
      return {
        success: false,
        error: "A signup request with this name or email already exists.",
      };
    }

    // Insert new signup request
    const query = `
      INSERT INTO signup_requests (first_name, last_name, affiliation, email, signup_date)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;

    const values = [
      data.firstName,
      data.lastName,
      data.affiliation,
      data.email,
      new Date().toISOString(),
    ];

    const result = await pool.query(query, values);

    // Revalidate the page to show updated data if needed
    revalidatePath("/");

    return {
      success: true,
      id: result.rows[0].id,
    };
  } catch (error) {
    console.error("Error submitting to database:", error);
    throw error;
  }
}
