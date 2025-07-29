--
-- Name: edf_config_channels; Type: TABLE; Schema: public; Owner: {owner}
--

CREATE TABLE public.edf_config_channels (
    id SERIAL PRIMARY KEY,
    config_id INTEGER NOT NULL,
    channel VARCHAR(100) NOT NULL,
    FOREIGN KEY (config_id) REFERENCES public.edf_configs(id)
);

ALTER TABLE public.edf_config_channels OWNER TO {owner};
