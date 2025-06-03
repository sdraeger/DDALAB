--
-- Name: help_tickets; Type: TABLE; Schema: public; Owner: {owner}
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

ALTER TABLE public.help_tickets OWNER TO {owner};

--
-- Name: help_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: {owner}
--

CREATE SEQUENCE public.help_tickets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER TABLE public.help_tickets_id_seq OWNER TO {owner};

--
-- Name: help_tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: {owner}
--

ALTER SEQUENCE public.help_tickets_id_seq OWNED BY public.help_tickets.id;

--
-- Name: help_tickets id; Type: DEFAULT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.help_tickets ALTER COLUMN id SET DEFAULT nextval('public.help_tickets_id_seq'::regclass);

--
-- Name: help_tickets help_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.help_tickets
    ADD CONSTRAINT help_tickets_pkey PRIMARY KEY (id);

--
-- Name: help_tickets help_tickets_user_id_key; Type: CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.help_tickets
    ADD CONSTRAINT help_tickets_user_id_key UNIQUE (user_id);

--
-- Name: idx_help_tickets_user_id; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX idx_help_tickets_user_id ON public.help_tickets USING btree (user_id);

--
-- Name: help_tickets help_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.help_tickets
    ADD CONSTRAINT help_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
