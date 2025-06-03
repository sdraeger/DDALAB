--
-- Name: annotations; Type: TABLE; Schema: public; Owner: {owner}
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

ALTER TABLE public.annotations OWNER TO {owner};

--
-- Name: annotations_id_seq; Type: SEQUENCE; Schema: public; Owner: {owner}
--

CREATE SEQUENCE public.annotations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER TABLE public.annotations_id_seq OWNER TO {owner};

--
-- Name: annotations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: {owner}
--

ALTER SEQUENCE public.annotations_id_seq OWNED BY public.annotations.id;

--
-- Name: annotations id; Type: DEFAULT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.annotations ALTER COLUMN id SET DEFAULT nextval('public.annotations_id_seq'::regclass);

--
-- Name: annotations annotations_pkey; Type: CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.annotations
    ADD CONSTRAINT annotations_pkey PRIMARY KEY (id);

--
-- Name: idx_annotations_file_path; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX idx_annotations_file_path ON public.annotations USING btree (file_path);

--
-- Name: idx_annotations_user_id; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX idx_annotations_user_id ON public.annotations USING btree (user_id);

--
-- Name: annotations annotations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.annotations
    ADD CONSTRAINT annotations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
