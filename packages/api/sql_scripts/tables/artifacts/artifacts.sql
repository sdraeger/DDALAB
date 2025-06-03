--
-- Name: artifacts; Type: TABLE; Schema: public; Owner: {owner}
--

CREATE TABLE public.artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES public.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.artifacts OWNER TO {owner};

--
-- Name: artifacts artifacts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.artifacts
    ADD CONSTRAINT artifacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
