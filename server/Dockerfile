FROM python:3.10-slim

WORKDIR /app

COPY server /app/server
# COPY . /app/server

# COPY ./.env /app/.env
RUN chmod +x /app/server/start.sh

RUN apt update
RUN apt install -y \
	build-essential \
	gcc \
	openssl \
	libssl-dev \
	libpq-dev \
	curl \
	netcat-openbsd \
	&& rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip
RUN pip install -r server/requirements.txt

RUN useradd -m -r apiuser && chown apiuser:apiuser /app
USER apiuser

EXPOSE 8001
EXPOSE 8002

CMD ["/app/server/start.sh"]
