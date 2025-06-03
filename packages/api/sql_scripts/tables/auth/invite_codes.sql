--
-- Name: invite_codes; Type: TABLE; Schema: public; Owner: {owner}
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

ALTER TABLE public.invite_codes OWNER TO {owner};

--
-- Name: TABLE invite_codes; Type: COMMENT; Schema: public; Owner: {owner}
--

COMMENT ON TABLE public.invite_codes IS 'Stores registration invite codes';

--
-- Name: COLUMN invite_codes.code; Type: COMMENT; Schema: public; Owner: {owner}
--

COMMENT ON COLUMN public.invite_codes.code IS 'Unique invite code string';

--
-- Name: COLUMN invite_codes.max_uses; Type: COMMENT; Schema: public; Owner: {owner}
--

COMMENT ON COLUMN public.invite_codes.max_uses IS 'Maximum number of times this code can be used (default: 1 for single-use)';

--
-- Name: COLUMN invite_codes.uses; Type: COMMENT; Schema: public; Owner: {owner}
--

COMMENT ON COLUMN public.invite_codes.uses IS 'Number of times this code has been used';

--
-- Name: invite_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: {owner}
--

CREATE SEQUENCE public.invite_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER TABLE public.invite_codes_id_seq OWNER TO {owner};

--
-- Name: invite_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: {owner}
--

ALTER SEQUENCE public.invite_codes_id_seq OWNED BY public.invite_codes.id;

--
-- Name: invite_codes id; Type: DEFAULT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.invite_codes ALTER COLUMN id SET DEFAULT nextval('public.invite_codes_id_seq'::regclass);

--
-- Name: invite_codes invite_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_code_key UNIQUE (code);

--
-- Name: invite_codes invite_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_pkey PRIMARY KEY (id);

--
-- Name: idx_invite_codes_code; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX idx_invite_codes_code ON public.invite_codes USING btree (code);

--
-- Name: invite_codes invite_codes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
