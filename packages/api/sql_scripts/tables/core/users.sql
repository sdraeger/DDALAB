SET default_tablespace = '';
SET default_table_access_method = heap;

--
-- Name: users; Type: TABLE; Schema: public; Owner: {owner}
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

ALTER TABLE public.users OWNER TO {owner};

--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: {owner}
--

COMMENT ON TABLE public.users IS 'Stores user credentials with bcrypt password hashing';

--
-- Name: COLUMN users.password_hash; Type: COMMENT; Schema: public; Owner: {owner}
--

COMMENT ON COLUMN public.users.password_hash IS 'Bcrypt hashed password - NEVER store plain text passwords';

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: {owner}
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER TABLE public.users_id_seq OWNER TO {owner};

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: {owner}
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.users
    ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX idx_users_email ON public.users USING btree (email);

--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX idx_users_username ON public.users USING btree (username);
