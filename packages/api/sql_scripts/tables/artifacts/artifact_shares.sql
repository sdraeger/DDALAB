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

--
-- Name: artifact_shares artifact_shares_artifact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.artifact_shares
    ADD CONSTRAINT artifact_shares_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id);

--
-- Name: artifact_shares artifact_shares_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.artifact_shares
    ADD CONSTRAINT artifact_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: artifact_shares artifact_shares_shared_with_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.artifact_shares
    ADD CONSTRAINT artifact_shares_shared_with_user_id_fkey FOREIGN KEY (shared_with_user_id) REFERENCES public.users(id);
