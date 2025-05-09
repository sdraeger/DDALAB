-- Insert an admin user with a secure bcrypt hashed password
-- Default admin credentials:
-- Username: admin
-- Email: admin@example.com
-- Password: AdminPassword123
-- (You should change these after first login)

INSERT INTO public.users (
    username,
    password_hash,
    email,
    first_name,
    last_name,
    is_active,
    is_admin
) VALUES (
    '{username}',
    '{password_hash}',
    '{email}',
    '{first_name}',
    '{last_name}',
    true,
    true
);

-- Create initial user preferences for the admin user
INSERT INTO public.user_preferences (
    user_id,
    theme
) VALUES (
    (SELECT id FROM public.users WHERE username = 'admin'),
    'light'
);
