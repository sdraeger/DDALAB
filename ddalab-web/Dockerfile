# Use an official Node.js runtime as the base image
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY .env.local ./

RUN apk update && apk add --no-cache \
	build-base \
	gcc \
	openssl \
	openssl-dev \
	libpq-dev \
	&& rm -rf /var/cache/apk/*

RUN npm install

COPY . .

RUN npm run build

FROM node:18-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN apk update && apk add --no-cache curl \
	&& rm -rf /var/cache/apk/*

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/.next ./.next

RUN npm install --production

EXPOSE 3000

CMD ["npm", "start"]
