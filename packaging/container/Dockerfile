# The DDALAB BIDS App. Build from the repository root:
#   docker build -f packaging/container/Dockerfile -t ddalab .
# Run:
#   docker run --rm -v /data/ds:/data:ro -v /data/out:/out ddalab /data /out participant [--participant_label 01] [ddalab batch options]
#   apptainer run -B /data docker://ghcr.io/sdraeger/ddalab:<version> /data/ds /data/out participant
# It runs on the CPU: the slim base has no cuBLAS, which `--device cuda` needs besides the driver.
# `ddalab stream` reads Lab Streaming Layer streams with the liblsl the image carries. LSL finds streams by multicast and
# the web app connects to 127.0.0.1, so it needs the host's network (Linux):
#   docker run --rm --network host --entrypoint ddalab ghcr.io/sdraeger/ddalab stream --stream EEG --serve 8765
FROM rust:1-bookworm AS build
# Compiled into every result document as reproduction.git_commit.
ARG DDALAB_GIT_COMMIT
ENV DDALAB_GIT_COMMIT=${DDALAB_GIT_COMMIT}
WORKDIR /src
COPY packages/dda-rs packages/dda-rs
COPY packages/ddalab-cli packages/ddalab-cli
RUN cargo build --release --locked --manifest-path packages/ddalab-cli/Cargo.toml
# liblsl for `ddalab stream`: Debian does not package it; this is the upstream build for Ubuntu 22.04 (glibc 2.35).
ARG LIBLSL=1.17.7
ARG LIBLSL_SHA256=a73dfca12aaffe65d22599032fa6ba683e9a54e2f8e4212cfdb05d5854b86bec
RUN curl -fsSL -o /tmp/liblsl.tar.gz "https://github.com/sccn/liblsl/releases/download/v${LIBLSL}/liblsl-${LIBLSL}-jammy_amd64.tar.gz" \
 && echo "${LIBLSL_SHA256}  /tmp/liblsl.tar.gz" | sha256sum -c - \
 && tar xzf /tmp/liblsl.tar.gz -C /tmp \
 && cp "/tmp/liblsl-${LIBLSL}-jammy_amd64/lib/liblsl.so.${LIBLSL}" /src/liblsl.so

FROM debian:bookworm-slim
ARG VERSION=dev
LABEL org.opencontainers.image.title="DDALAB" \
      org.opencontainers.image.description="Delay differential analysis of BIDS EEG and iEEG datasets, as a BIDS App" \
      org.opencontainers.image.source="https://github.com/sdraeger/DDALAB" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"
COPY --from=build /src/packages/ddalab-cli/target/release/ddalab /usr/local/bin/ddalab
COPY --from=build /src/liblsl.so /usr/local/lib/liblsl.so
ENV DDALAB_LIBLSL=/usr/local/lib/liblsl.so
COPY packaging/container/run.sh /usr/local/bin/run.sh
ENTRYPOINT ["/usr/local/bin/run.sh"]
