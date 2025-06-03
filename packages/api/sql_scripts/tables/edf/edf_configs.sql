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

--
-- Name: edf_configs edf_configs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.edf_configs
    ADD CONSTRAINT edf_configs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
