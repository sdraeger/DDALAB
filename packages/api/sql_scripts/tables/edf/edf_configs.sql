--
-- Name: edf_configs; Type: TABLE; Schema: public; Owner: {owner}
--

CREATE TABLE public.edf_configs (
    id SERIAL PRIMARY KEY,
    file_hash VARCHAR(255) NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES public.users(id)
);

ALTER TABLE public.edf_configs OWNER TO {owner};
