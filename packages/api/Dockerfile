FROM python:3.10-alpine

WORKDIR /app/server

# Copy server files
COPY packages/api /app/server
RUN ls -la /app/server/
RUN chmod +x /app/server/start.sh

# Install dependencies
RUN apk update && apk add --no-cache \
	build-base \
	gcc \
	openssl \
	openssl-dev \
	libpq-dev \
	curl \
	netcat-openbsd \
	wget \
	bash \
	&& rm -rf /var/cache/apk/*

# Install DDA binary
RUN mkdir -p /app/server/bin
RUN wget https://snl.salk.edu/~sfdraeger/dda/downloads/run_DDA_EPILEPSY -O /app/server/bin/run_DDA_ASCII
RUN chmod +x /app/server/bin/run_DDA_ASCII

# Install Python dependencies
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Create non-root user
RUN adduser -D -s /bin/sh apiuser \
    && chown apiuser:apiuser /app \
    && mkdir -p /tmp/prometheus \
    && chown -R apiuser:apiuser /tmp/prometheus \
    && chmod 755 /tmp/prometheus \
    && mkdir -p /app/data \
    && chown -R apiuser:apiuser /app/data \
    && mkdir -p /app/server/.config \
    && chown -R apiuser:apiuser /app/server/.config
USER apiuser

# Expose ports
EXPOSE 8001
EXPOSE 8002

# Run server
CMD ["/bin/bash", "/app/server/start.sh"]
