-- Create the signup_requests table
CREATE TABLE IF NOT EXISTS signup_requests (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  affiliation VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  signup_date TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster searches
CREATE INDEX IF NOT EXISTS idx_signup_email ON signup_requests(email);
CREATE INDEX IF NOT EXISTS idx_signup_names ON signup_requests(first_name, last_name);
