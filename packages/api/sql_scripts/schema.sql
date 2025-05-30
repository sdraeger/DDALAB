SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: admin
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO admin;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: annotations; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.annotations (
    id integer NOT NULL,
    user_id integer,
    file_path character varying(255) NOT NULL,
    start_time integer NOT NULL,
    end_time integer,
    text text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.annotations OWNER TO admin;

--
-- Name: annotations_id_seq; Type: SEQUENCE; Schema: public; Owner: admin
--

CREATE SEQUENCE public.annotations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.annotations_id_seq OWNER TO admin;

--
-- Name: annotations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: admin
--

ALTER SEQUENCE public.annotations_id_seq OWNED BY public.annotations.id;


--
-- Name: favorite_files; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.favorite_files (
    id integer NOT NULL,
    user_id integer,
    file_path text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.favorite_files OWNER TO admin;

--
-- Name: favorite_files_id_seq; Type: SEQUENCE; Schema: public; Owner: admin
--

CREATE SEQUENCE public.favorite_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.favorite_files_id_seq OWNER TO admin;

--
-- Name: favorite_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: admin
--

ALTER SEQUENCE public.favorite_files_id_seq OWNED BY public.favorite_files.id;


--
-- Name: help_tickets; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.help_tickets (
    id integer NOT NULL,
    user_id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text NOT NULL,
    status character varying(255) DEFAULT 'open'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT help_tickets_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'closed'::character varying])::text[])))
);


ALTER TABLE public.help_tickets OWNER TO admin;

--
-- Name: help_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: admin
--

CREATE SEQUENCE public.help_tickets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.help_tickets_id_seq OWNER TO admin;

--
-- Name: help_tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: admin
--

ALTER SEQUENCE public.help_tickets_id_seq OWNED BY public.help_tickets.id;


--
-- Name: invite_codes; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.invite_codes (
    id integer NOT NULL,
    code character varying(50) NOT NULL,
    email character varying(255),
    created_by integer,
    max_uses integer DEFAULT 1,
    uses integer DEFAULT 0,
    expires_at timestamp without time zone,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.invite_codes OWNER TO admin;

--
-- Name: TABLE invite_codes; Type: COMMENT; Schema: public; Owner: admin
--

COMMENT ON TABLE public.invite_codes IS 'Stores registration invite codes';


--
-- Name: COLUMN invite_codes.code; Type: COMMENT; Schema: public; Owner: admin
--

COMMENT ON COLUMN public.invite_codes.code IS 'Unique invite code string';


--
-- Name: COLUMN invite_codes.max_uses; Type: COMMENT; Schema: public; Owner: admin
--

COMMENT ON COLUMN public.invite_codes.max_uses IS 'Maximum number of times this code can be used (default: 1 for single-use)';


--
-- Name: COLUMN invite_codes.uses; Type: COMMENT; Schema: public; Owner: admin
--

COMMENT ON COLUMN public.invite_codes.uses IS 'Number of times this code has been used';


--
-- Name: invite_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: admin
--

CREATE SEQUENCE public.invite_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.invite_codes_id_seq OWNER TO admin;

--
-- Name: invite_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: admin
--

ALTER SEQUENCE public.invite_codes_id_seq OWNED BY public.invite_codes.id;


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.password_reset_tokens (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token character varying(100) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.password_reset_tokens OWNER TO admin;

--
-- Name: TABLE password_reset_tokens; Type: COMMENT; Schema: public; Owner: admin
--

COMMENT ON TABLE public.password_reset_tokens IS 'Stores temporary password reset tokens';


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: admin
--

CREATE SEQUENCE public.password_reset_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.password_reset_tokens_id_seq OWNER TO admin;

--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: admin
--

ALTER SEQUENCE public.password_reset_tokens_id_seq OWNED BY public.password_reset_tokens.id;


--
-- Name: signup_requests; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.signup_requests (
    id integer NOT NULL,
    first_name character varying(255) NOT NULL,
    last_name character varying(255) NOT NULL,
    affiliation character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    signup_date timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.signup_requests OWNER TO admin;

--
-- Name: signup_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: admin
--

CREATE SEQUENCE public.signup_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.signup_requests_id_seq OWNER TO admin;

--
-- Name: signup_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: admin
--

ALTER SEQUENCE public.signup_requests_id_seq OWNED BY public.signup_requests.id;


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.user_preferences (
    user_id integer NOT NULL,
    theme character varying(10),
    eeg_zoom_factor double precision,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.user_preferences OWNER TO admin;


--
-- Name: users; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.users (
    id SERIAL PRIMARY KEY,
    username character varying(255) UNIQUE NOT NULL,
    password_hash character(60) NOT NULL,
    email character varying(255) UNIQUE NOT NULL,
    first_name character varying(100),
    last_name character varying(100),
    is_active boolean DEFAULT true,
    is_admin boolean DEFAULT false,
    last_login timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.users OWNER TO admin;

--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: admin
--

COMMENT ON TABLE public.users IS 'Stores user credentials with bcrypt password hashing';


--
-- Name: COLUMN users.password_hash; Type: COMMENT; Schema: public; Owner: admin
--

COMMENT ON COLUMN public.users.password_hash IS 'Bcrypt hashed password - NEVER store plain text passwords';


--
-- Name: edf_configs; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.edf_configs (
    id SERIAL PRIMARY KEY,
    file_hash VARCHAR(255) NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES public.users(id)
);

ALTER TABLE public.edf_configs OWNER TO admin;

--
-- Name: edf_config_channels; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public.edf_config_channels (
    id SERIAL PRIMARY KEY,
    config_id INTEGER NOT NULL,
    channel VARCHAR(100) NOT NULL,
    FOREIGN KEY (config_id) REFERENCES public.edf_configs(id)
);

ALTER TABLE public.edf_config_channels OWNER TO admin;

CREATE TABLE public.artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255),
    file_path VARCHAR(255) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES public.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.artifacts OWNER TO admin;

CREATE TABLE public.artifact_shares (
    id SERIAL PRIMARY KEY,
    artifact_id UUID NOT NULL REFERENCES public.artifacts(id),
    user_id INTEGER NOT NULL REFERENCES public.users(id),
    shared_with_user_id INTEGER NOT NULL REFERENCES public.users(id),
    UNIQUE (artifact_id, shared_with_user_id)
);

ALTER TABLE public.artifact_shares OWNER TO admin;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: admin
--

-- CREATE SEQUENCE public.users_id_seq
--     AS integer
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;


ALTER TABLE public.users_id_seq OWNER TO admin;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: admin
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: annotations id; Type: DEFAULT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.annotations ALTER COLUMN id SET DEFAULT nextval('public.annotations_id_seq'::regclass);


--
-- Name: favorite_files id; Type: DEFAULT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.favorite_files ALTER COLUMN id SET DEFAULT nextval('public.favorite_files_id_seq'::regclass);


--
-- Name: help_tickets id; Type: DEFAULT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.help_tickets ALTER COLUMN id SET DEFAULT nextval('public.help_tickets_id_seq'::regclass);


--
-- Name: invite_codes id; Type: DEFAULT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.invite_codes ALTER COLUMN id SET DEFAULT nextval('public.invite_codes_id_seq'::regclass);


--
-- Name: password_reset_tokens id; Type: DEFAULT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.password_reset_tokens ALTER COLUMN id SET DEFAULT nextval('public.password_reset_tokens_id_seq'::regclass);


--
-- Name: signup_requests id; Type: DEFAULT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.signup_requests ALTER COLUMN id SET DEFAULT nextval('public.signup_requests_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: annotations annotations_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.annotations
    ADD CONSTRAINT annotations_pkey PRIMARY KEY (id);


--
-- Name: favorite_files favorite_files_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.favorite_files
    ADD CONSTRAINT favorite_files_pkey PRIMARY KEY (id);


--
-- Name: favorite_files favorite_files_user_id_file_path_key; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.favorite_files
    ADD CONSTRAINT favorite_files_user_id_file_path_key UNIQUE (user_id, file_path);


--
-- Name: help_tickets help_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.help_tickets
    ADD CONSTRAINT help_tickets_pkey PRIMARY KEY (id);


--
-- Name: help_tickets help_tickets_user_id_key; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.help_tickets
    ADD CONSTRAINT help_tickets_user_id_key UNIQUE (user_id);


--
-- Name: invite_codes invite_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_code_key UNIQUE (code);


--
-- Name: invite_codes invite_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_key UNIQUE (token);


--
-- Name: signup_requests signup_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.signup_requests
    ADD CONSTRAINT signup_requests_pkey PRIMARY KEY (id);


--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: admin
--

-- ALTER TABLE ONLY public.users
--     ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: admin
--

-- ALTER TABLE ONLY public.users
--     ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: favorite_files_file_path_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX favorite_files_file_path_idx ON public.favorite_files USING btree (file_path);


--
-- Name: idx_annotations_file_path; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX idx_annotations_file_path ON public.annotations USING btree (file_path);


--
-- Name: idx_annotations_user_id; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX idx_annotations_user_id ON public.annotations USING btree (user_id);


--
-- Name: idx_help_tickets_user_id; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX idx_help_tickets_user_id ON public.help_tickets USING btree (user_id);


--
-- Name: idx_invite_codes_code; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX idx_invite_codes_code ON public.invite_codes USING btree (code);


--
-- Name: idx_signup_email; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX idx_signup_email ON public.signup_requests USING btree (email);


--
-- Name: idx_signup_names; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX idx_signup_names ON public.signup_requests USING btree (first_name, last_name);


--
-- Name: idx_user_preferences_user_id; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX idx_user_preferences_user_id ON public.user_preferences USING btree (user_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX idx_users_username ON public.users USING btree (username);


--
-- Name: user_preferences update_user_preferences_updated_at; Type: TRIGGER; Schema: public; Owner: admin
--

CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: annotations annotations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.annotations
    ADD CONSTRAINT annotations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: favorite_files favorite_files_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.favorite_files
    ADD CONSTRAINT favorite_files_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: help_tickets help_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.help_tickets
    ADD CONSTRAINT help_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: invite_codes invite_codes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_preferences user_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--
