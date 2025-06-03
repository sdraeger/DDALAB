--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: {owner}
--

CREATE TABLE public.user_preferences (
    user_id integer NOT NULL,
    theme character varying(10),
    eeg_zoom_factor double precision,
    updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.user_preferences OWNER TO {owner};

--
-- Name: user_preferences user_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);

--
-- Name: idx_user_preferences_user_id; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX idx_user_preferences_user_id ON public.user_preferences USING btree (user_id);

--
-- Name: user_preferences update_user_preferences_updated_at; Type: TRIGGER; Schema: public; Owner: {owner}
--

CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--
-- Name: user_preferences user_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
