--
-- Name: user_layouts; Type: TABLE; Schema: public; Owner: {owner}
--

CREATE TABLE public.user_layouts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES public.users(id),
    layout_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.user_layouts OWNER TO {owner};
