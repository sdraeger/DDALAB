# Adding New Tables to the Decomposed Schema

This guide shows how to add new tables to the decomposed SQL schema system.

## Step-by-Step Process

### 1. Create the SQL File

Create a new SQL file in the appropriate subdirectory:

```bash
# Choose the appropriate category:
# - tables/core/         - Core system tables
# - tables/auth/         - Authentication tables
# - tables/content/      - User content tables
# - tables/edf/          - EDF-specific tables
# - tables/artifacts/    - Artifact management
# - tables/layouts/      - UI layouts
# - tables/[new_category]/ - Create new category if needed

# Example: adding a notifications table
touch packages/api/sql_scripts/tables/content/notifications.sql
```

### 2. Define the Table Structure

In your new SQL file, include all necessary components:

```sql
--
-- Name: notifications; Type: TABLE; Schema: public; Owner: {owner}
--

CREATE TABLE public.notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    notification_type VARCHAR(50) DEFAULT 'info',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.notifications OWNER TO {owner};

--
-- Name: TABLE notifications; Type: COMMENT; Schema: public; Owner: {owner}
--

COMMENT ON TABLE public.notifications IS 'User notifications and alerts';

--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: {owner}
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER TABLE public.notifications_id_seq OWNER TO {owner};

--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: {owner}
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;

--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);

--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);

--
-- Name: idx_notifications_is_read; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX idx_notifications_is_read ON public.notifications USING btree (is_read);

--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
```

### 3. Update Configuration

Edit `packages/api/sql_scripts/table_config.py`:

```python
# Add to TABLE_FILE_MAP
TABLE_FILE_MAP = {
    # ... existing mappings ...
    "notifications": "tables/content/notifications.sql",
}

# Add to TABLE_EXECUTION_ORDER (respecting dependencies)
TABLE_EXECUTION_ORDER = [
    # ... existing order ...
    "tables/content/notifications.sql",  # After users.sql
    # ... rest of the order ...
]
```

### 4. Test the Changes

Run the apply script to verify everything works:

```bash
cd packages/api
python apply_sql_files.py --username admin --password pass --email admin@example.com --first_name Admin --last_name User
```

## Key Considerations

### Dependencies

- **Users dependency**: Most tables should reference `public.users(id)`
- **Order matters**: Tables must be created after their dependencies
- **Foreign keys**: Define relationships in the correct order

### Naming Conventions

- **Table names**: Use lowercase with underscores (`user_notifications`)
- **File names**: Match table names exactly (`user_notifications.sql`)
- **Indexes**: Prefix with `idx_` (`idx_notifications_user_id`)
- **Constraints**: Use descriptive names (`notifications_user_id_fkey`)

### Required Components

Each table file should include:

1. **Table definition** with all columns
2. **Owner assignment** using `{owner}` placeholder
3. **Sequences** for auto-incrementing columns
4. **Primary key** constraints
5. **Indexes** for commonly queried columns
6. **Foreign key** constraints for relationships
7. **Comments** for documentation

### File Organization

```
tables/
├── core/           # Essential system tables (users, preferences)
├── auth/           # Authentication (tokens, codes, sessions)
├── content/        # User-generated content (annotations, files)
├── edf/            # Domain-specific EDF functionality
├── artifacts/      # File and data artifacts
├── layouts/        # UI state and layouts
└── [category]/     # Add new categories as needed
```

## Example: Adding a Complex Table with Dependencies

```sql
-- File: tables/content/user_sessions.sql
-- Depends on: users table

CREATE TABLE public.user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.user_sessions OWNER TO {owner};

-- Indexes for performance
CREATE INDEX idx_user_sessions_user_id ON public.user_sessions USING btree (user_id);
CREATE INDEX idx_user_sessions_token ON public.user_sessions USING btree (session_token);
CREATE INDEX idx_user_sessions_active ON public.user_sessions USING btree (is_active);
CREATE INDEX idx_user_sessions_expires ON public.user_sessions USING btree (expires_at);

-- Foreign key constraint
ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
```

Then update `table_config.py`:

```python
TABLE_FILE_MAP["user_sessions"] = "tables/content/user_sessions.sql"
# Add to execution order after users.sql but before any tables that might depend on sessions
```

## Verification

After making changes:

1. **Syntax check**: Ensure SQL is valid
2. **Dependency check**: Verify execution order
3. **Test run**: Execute the apply script
4. **Review logs**: Check for any errors or warnings

The system will automatically handle creating only missing tables in the correct dependency order.
