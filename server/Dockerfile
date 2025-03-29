FROM python:3.10-slim

WORKDIR /app

COPY server/ /app/server
COPY .env /app/.env

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

CMD ["sh", "-c", "until nc -z postgres 5432; do echo 'Waiting for PostgreSQL...'; sleep 1; done; python server/apply_sql_files.py --username admin --password AdminPassword123 --email admin@example.com --first_name Admin --last_name User && python -m server.main"]
