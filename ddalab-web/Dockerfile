# Use an official Node.js runtime as the base image
FROM node:18-alpine AS builder

WORKDIR /app

RUN apk update && apk add --no-cache \
	build-base \
	gcc \
	openssl \
	openssl-dev \
	libpq-dev \
	&& rm -rf /var/cache/apk/*

COPY ddalab-web/package*.json ./

RUN npm install

COPY ddalab-web .

# Load .env and run build
# RUN node -e "require('dotenv').config({ path: './.env' });" && npm run build
RUN echo "NEXT_PUBLIC_API_URL=https://localhost" > /app/.env.default
RUN echo "SESSION_EXPIRATION=10080" >> /app/.env.default
RUN npm install dotenv && \
	node -e "require('dotenv').config({ path: './.env.default' });" && \
	export NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL && \
	export SESSION_EXPIRATION=$SESSION_EXPIRATION && \
	npm run build

FROM node:18-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN apk update && apk add --no-cache curl \
	&& rm -rf /var/cache/apk/*

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/start.js ./start.js

RUN npm install --production

EXPOSE 3000

CMD ["node", "start.js"]
