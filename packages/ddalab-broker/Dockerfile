# Build stage
FROM rust:1.83-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy Cargo files
COPY Cargo.toml Cargo.lock* ./

# Copy source code
COPY src ./src

# Build release binary
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Copy binary from builder
COPY --from=builder /app/target/release/ddalab-broker /app/ddalab-broker

# Expose WebSocket port
EXPOSE 8080

# Set environment variables
ENV RUST_LOG=ddalab_broker=info

# Run broker
CMD ["/app/ddalab-broker"]
