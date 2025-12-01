# Build stage
FROM rust:1.91-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy Cargo files
COPY Cargo.toml Cargo.lock* ./

# Create a dummy src to cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs

# Build dependencies (this layer is cached)
RUN cargo build --release || true

# Copy actual source code
COPY src ./src

# Touch main.rs to ensure rebuild
RUN touch src/main.rs

# Build release binary
RUN cargo build --release

# Runtime stage - need trixie for GLIBC 2.39+ (required by Rust 1.91)
FROM debian:trixie-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 ddalab

# Copy binary from builder
COPY --from=builder /app/target/release/ddalab-server /app/ddalab-server

# Create data directory
RUN mkdir -p /app/data && chown -R ddalab:ddalab /app

# Switch to non-root user
USER ddalab

# Expose port
EXPOSE 8080

# Set environment variables
ENV RUST_LOG=ddalab_server=info
ENV DDALAB_PORT=8080
ENV DDALAB_BIND_ADDR=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Run server
CMD ["/app/ddalab-server"]
