-- Migration: 005_content_types.sql
-- Adds content_type column and renames result_id to content_id for multi-content sharing

-- Add content_type column with default for backward compatibility
ALTER TABLE shared_results
ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'dda_result';

-- Rename result_id to content_id (PostgreSQL)
-- First check if the column exists as result_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shared_results' AND column_name = 'result_id'
    ) THEN
        ALTER TABLE shared_results RENAME COLUMN result_id TO content_id;
    END IF;
END $$;

-- Add content_data column for storing serialized content
-- This holds the actual shareable content as JSON (for annotations, workflows, params)
ALTER TABLE shared_results
ADD COLUMN IF NOT EXISTS content_data JSONB;

-- Create index for content type queries
CREATE INDEX IF NOT EXISTS idx_shared_results_content_type
ON shared_results(content_type);

-- Create index for owner + content type queries (common for "my workflows" etc)
CREATE INDEX IF NOT EXISTS idx_shared_results_owner_type
ON shared_results(owner_user_id, content_type);

-- Update existing rows to have explicit content_type (should already be 'dda_result' from default)
UPDATE shared_results
SET content_type = 'dda_result'
WHERE content_type IS NULL OR content_type = '';
