# The DDALAB BIDS App. Build from the repository root:
#   docker build -f packaging/container/Dockerfile -t ddalab .
# Run:
#   docker run --rm -v /data/ds:/data:ro -v /data/out:/out ddalab /data /out participant [--participant_label 01] [-- ddalab batch options]
#   apptainer run docker://ghcr.io/sdraeger/ddalab:<version> /data /out participant
FROM rust:1-bookworm AS build
# Compiled into every result document as reproduction.git_commit.
ARG DDALAB_GIT_COMMIT
ENV DDALAB_GIT_COMMIT=${DDALAB_GIT_COMMIT}
WORKDIR /src
COPY packages/dda-rs packages/dda-rs
COPY packages/ddalab-cli packages/ddalab-cli
# cudarc loads the CUDA driver at run time: `--device cuda` works with `docker run --gpus all`.
RUN cargo build --release --locked --features cuda --manifest-path packages/ddalab-cli/Cargo.toml

FROM debian:bookworm-slim
ARG VERSION=dev
LABEL org.opencontainers.image.title="DDALAB" \
      org.opencontainers.image.description="Delay differential analysis of BIDS EEG and iEEG datasets, as a BIDS App" \
      org.opencontainers.image.source="https://github.com/sdraeger/DDALAB" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"
COPY --from=build /src/packages/ddalab-cli/target/release/ddalab /usr/local/bin/ddalab
COPY packaging/container/run.sh /usr/local/bin/run.sh
ENTRYPOINT ["/usr/local/bin/run.sh"]
