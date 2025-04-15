FROM python:3.10-slim

WORKDIR /app

# Copy server files
COPY server /app/server
RUN chmod +x /app/server/start.sh

# Install dependencies
RUN apt update
RUN apt install -y \
	build-essential \
	gcc \
	openssl \
	libssl-dev \
	libpq-dev \
	curl \
	netcat-openbsd \
	wget \
	&& rm -rf /var/lib/apt/lists/*

# Install DDA binary
RUN mkdir -p /app/server/bin
RUN wget https://snl.salk.edu/~sfdraeger/dda/downloads/run_DDA_EPILEPSY -O /app/server/bin/run_DDA_ASCII
RUN chmod +x /app/server/bin/run_DDA_ASCII

# Install Python dependencies
RUN pip install --upgrade pip
RUN pip install -r server/requirements.txt

# Create non-root user
RUN useradd -m -r apiuser && chown apiuser:apiuser /app
USER apiuser

# Expose ports
EXPOSE 8001
EXPOSE 8002

# Run server
CMD ["/app/server/start.sh"]
