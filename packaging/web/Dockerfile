# The DDALAB web app, served by Caddy. Build from a folder holding this file, Caddyfile and the app as dist/ (the
# contents of ddalab-web-<version>.zip from the release page, or packages/ddalab-web/dist):
#   docker build -t ddalab-web .
# Run on this computer, at http://localhost:8080/:
#   docker run -d -p 8080:8080 ghcr.io/sdraeger/ddalab-web
# Run for other computers, with HTTPS and a certificate Caddy obtains for the server's DNS name:
#   docker run -d -p 80:80 -p 443:443 -e DDALAB_ADDRESS=ddalab.example.org -v ddalab-caddy:/data ghcr.io/sdraeger/ddalab-web
# No RUN step: the image builds for every platform without emulation.
FROM caddy:2.10-alpine
ARG VERSION=dev
LABEL org.opencontainers.image.title="DDALAB web app" \
      org.opencontainers.image.description="The DDALAB web app for delay differential analysis, served by Caddy" \
      org.opencontainers.image.source="https://github.com/sdraeger/DDALAB" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"
ENV DDALAB_ADDRESS=:8080
COPY Caddyfile /etc/caddy/Caddyfile
COPY dist /srv
EXPOSE 8080 80 443
