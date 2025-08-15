-- Fix help_tickets table by removing incorrect unique constraint on user_id
-- This allows users to create multiple help tickets

-- Drop the unique constraint if it exists
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'help_tickets_user_id_key' 
        AND table_name = 'help_tickets'
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.help_tickets DROP CONSTRAINT help_tickets_user_id_key;
        RAISE NOTICE 'Dropped unique constraint help_tickets_user_id_key';
    ELSE
        RAISE NOTICE 'Unique constraint help_tickets_user_id_key does not exist';
    END IF;
END $$;

-- Verify the constraint was removed
SELECT constraint_name, constraint_type 
FROM information_schema.table_constraints 
WHERE table_name = 'help_tickets' 
AND table_schema = 'public';