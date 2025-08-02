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

# Copy and modify environment file for Next.js
COPY ../.env .env
RUN sed -i 's|NEXTAUTH_URL=https://localhost|NEXTAUTH_URL=http://localhost:3000|g' .env
RUN sed -i 's|NEXT_PUBLIC_NEXTAUTH_URL=https://localhost|NEXT_PUBLIC_NEXTAUTH_URL=http://localhost:3000|g' .env
RUN sed -i 's|API_URL=http://localhost:8001|API_URL=http://api:8001|g' .env
RUN echo "PYTHON_API_URL=http://api:8001" >> .env
RUN echo "NEXT_PUBLIC_APP_URL=http://localhost:3000" >> .env

# Create symlink for shared package
RUN mkdir -p node_modules/shared && \
	ln -sf /app/packages/shared/dist/* node_modules/shared/

# Build without dotenv (use local environment)
RUN npm run build:docker

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN apk update && apk add --no-cache curl \
	&& rm -rf /var/cache/apk/*

COPY --from=builder /app/packages/web/package*.json ./
COPY --from=builder /app/packages/web/public ./public
COPY --from=builder /app/packages/web/next.config.mjs ./
COPY --from=builder /app/packages/web/.next ./.next
COPY --from=builder /app/packages/web/start.cjs ./start.cjs
COPY --from=builder /app/packages/web/nextjs-patch.cjs ./nextjs-patch.cjs
COPY --from=builder /app/packages/web/webpack-patch.cjs ./webpack-patch.cjs
COPY --from=builder /app/packages/web/client-proxy-patch.cjs ./client-proxy-patch.cjs
COPY --from=builder /app/packages/web/.env ./.env
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/web/node_modules ./node_modules

# Install production dependencies
RUN npm install --production

EXPOSE 3000

CMD ["node", "start.cjs"]
