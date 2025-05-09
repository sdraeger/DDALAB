# Use an official Node.js runtime as the base image
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
RUN apk update && apk add --no-cache \
	build-base \
	gcc \
	openssl \
	openssl-dev \
	libpq-dev \
	&& rm -rf /var/cache/apk/*

# Create shared package directory and copy its contents
COPY packages/shared ./packages/shared

# Copy package files
COPY packages/web/package*.json ./packages/web/
COPY package*.json ./

# Install root dependencies first
RUN npm install

# Build shared package
WORKDIR /app/packages/shared
RUN npm install
RUN npm run build

# Install and build web package
WORKDIR /app/packages/web
RUN npm install
COPY packages/web .

# Load .env and run build
RUN echo "NEXT_PUBLIC_API_URL=https://localhost" > .env.local
RUN echo "SESSION_EXPIRATION=10080" >> .env.local

# Create symlink for shared package
RUN mkdir -p node_modules/shared && \
	ln -sf /app/packages/shared/dist/* node_modules/shared/

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN apk update && apk add --no-cache curl \
	&& rm -rf /var/cache/apk/*

COPY --from=builder /app/packages/web/package*.json ./
COPY --from=builder /app/packages/web/public ./public
COPY --from=builder /app/packages/web/next.config.mjs ./
COPY --from=builder /app/packages/web/.next ./.next
COPY --from=builder /app/packages/web/start.js ./start.js
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/web/node_modules ./node_modules
COPY --from=builder /app/packages/web/.env.local ./.env.local

# Install production dependencies
RUN npm install --production

EXPOSE 3000

CMD ["node", "start.js"]
