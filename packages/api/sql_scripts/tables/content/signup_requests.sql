--
-- Name: signup_requests; Type: TABLE; Schema: public; Owner: {owner}
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

ALTER TABLE public.signup_requests OWNER TO {owner};

--
-- Name: signup_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: {owner}
--

CREATE SEQUENCE public.signup_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER TABLE public.signup_requests_id_seq OWNER TO {owner};

--
-- Name: signup_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: {owner}
--

ALTER SEQUENCE public.signup_requests_id_seq OWNED BY public.signup_requests.id;

--
-- Name: signup_requests id; Type: DEFAULT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.signup_requests
    ALTER COLUMN id SET DEFAULT nextval('public.signup_requests_id_seq'::regclass);

--
-- Name: signup_requests signup_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.signup_requests
    ADD CONSTRAINT signup_requests_pkey PRIMARY KEY (id);

--
-- Name: idx_signup_email; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX idx_signup_email ON public.signup_requests USING btree (email);

--
-- Name: idx_signup_names; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX idx_signup_names ON public.signup_requests USING btree (first_name, last_name);
