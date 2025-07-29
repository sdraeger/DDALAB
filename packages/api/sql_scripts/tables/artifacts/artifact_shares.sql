--
-- Name: artifact_shares; Type: TABLE; Schema: public; Owner: {owner}
--

CREATE TABLE public.artifact_shares (
    id SERIAL PRIMARY KEY,
    artifact_id UUID NOT NULL REFERENCES public.artifacts(id),
    user_id INTEGER NOT NULL REFERENCES public.users(id),
    shared_with_user_id INTEGER NOT NULL REFERENCES public.users(id),
    UNIQUE (artifact_id, shared_with_user_id)
);

ALTER TABLE public.artifact_shares OWNER TO {owner};
