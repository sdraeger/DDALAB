SET default_tablespace = '';
SET default_table_access_method = heap;

--
-- Name: widget_data; Type: TABLE; Schema: public; Owner: {owner}
--

CREATE TABLE public.widget_data (
    id SERIAL PRIMARY KEY,
    user_id integer NOT NULL,
    data_key character varying(255) UNIQUE NOT NULL,
    widget_id character varying(255) NOT NULL,
    widget_data json NOT NULL,
    widget_metadata json,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.widget_data OWNER TO {owner};

--
-- Name: TABLE widget_data; Type: COMMENT; Schema: public; Owner: {owner}
--

COMMENT ON TABLE public.widget_data IS 'Stores widget data for users';

--
-- Name: widget_data_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: {owner}
--

ALTER TABLE ONLY public.widget_data
    ADD CONSTRAINT widget_data_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: idx_widget_data_data_key; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX idx_widget_data_data_key ON public.widget_data USING btree (data_key);

--
-- Name: idx_widget_data_user_id; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX idx_widget_data_user_id ON public.widget_data USING btree (user_id);

--
-- Name: idx_widget_data_widget_id; Type: INDEX; Schema: public; Owner: {owner}
--

CREATE INDEX idx_widget_data_widget_id ON public.widget_data USING btree (widget_id);