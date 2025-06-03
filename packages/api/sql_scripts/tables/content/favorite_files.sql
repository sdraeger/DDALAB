--
-- Name: favorite_files; Type: TABLE; Schema: public; Owner: {owner}
--

CREATE TABLE public.favorite_files (
    id integer NOT NULL,
    user_id integer,
    file_path text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.favorite_files OWNER TO {owner};

--
-- Name: favorite_files_id_seq; Type: SEQUENCE; Schema: public; Owner: {owner}
--

CREATE SEQUENCE public.favorite_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER TABLE public.favorite_files_id_seq OWNER TO {owner};

--
-- Name: favorite_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: {owner}
--

ALTER SEQUENCE public.favorite_files_id_seq OWNED BY public.favorite_files.id;

--
-- Name: favorite_files id; Type: DEFAULT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.favorite_files ALTER COLUMN id SET DEFAULT nextval('public.favorite_files_id_seq'::regclass);

--
-- Name: favorite_files favorite_files_pkey; Type: CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.favorite_files
    ADD CONSTRAINT favorite_files_pkey PRIMARY KEY (id);

--
-- Name: favorite_files favorite_files_user_id_file_path_key; Type: CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.favorite_files
    ADD CONSTRAINT favorite_files_user_id_file_path_key UNIQUE (user_id, file_path);

--
-- Name: favorite_files_file_path_idx; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX favorite_files_file_path_idx ON public.favorite_files USING btree (file_path);

--
-- Name: favorite_files favorite_files_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.favorite_files
    ADD CONSTRAINT favorite_files_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
