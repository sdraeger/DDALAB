#!/bin/bash
# Development helper script for DDALAB Sync Broker

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

COMMAND=${1:-help}

case "$COMMAND" in
  start)
    echo -e "${GREEN}🚀 Starting DDALAB Sync Broker (Docker Compose)${NC}"
    docker-compose up -d --build
    echo ""
    echo -e "${GREEN}✅ Broker started!${NC}"
    echo -e "${BLUE}WebSocket:${NC} ws://localhost:8080/ws"
    echo -e "${BLUE}HTTP API:${NC}  http://localhost:8080"
    echo -e "${BLUE}Health:${NC}    http://localhost:8080/health"
    echo ""
    echo "View logs: ./dev.sh logs"
    ;;

  stop)
    echo -e "${YELLOW}Stopping broker...${NC}"
    docker-compose down
    # Also stop standalone postgres if it exists
    if docker ps -a | grep -q ddalab-broker-postgres; then
      docker stop ddalab-broker-postgres 2>/dev/null || true
      docker rm ddalab-broker-postgres 2>/dev/null || true
    fi
    echo -e "${GREEN}✅ Broker stopped${NC}"
    ;;

  restart)
    echo -e "${YELLOW}Restarting broker...${NC}"
    docker-compose restart broker
    echo -e "${GREEN}✅ Broker restarted${NC}"
    ;;

  logs)
    docker-compose logs -f broker
    ;;

  db)
    echo -e "${BLUE}Connecting to PostgreSQL...${NC}"
    docker exec -it ddalab-broker-postgres psql -U ddalab -d ddalab_broker
    ;;

  test)
    echo -e "${BLUE}Running tests...${NC}"
    ./test-broker.sh
    ;;

  build)
    echo -e "${BLUE}Building broker...${NC}"
    cargo build --release
    echo -e "${GREEN}✅ Build complete: target/release/ddalab-broker${NC}"
    ;;

  run)
    echo -e "${BLUE}Running broker locally (requires PostgreSQL on localhost:5432)${NC}"
    export DATABASE_URL="${DATABASE_URL:-postgres://ddalab:test_password@localhost:5432/ddalab_broker}"
    export RUST_LOG="${RUST_LOG:-ddalab_broker=debug,tower_http=debug}"
    export BIND_ADDR="${BIND_ADDR:-0.0.0.0:8080}"
    cargo run
    ;;

  dev)
    echo -e "${GREEN}🔧 Starting development environment${NC}"
    echo ""

    # Start PostgreSQL if not running
    if ! docker ps | grep -q ddalab-broker-postgres; then
      echo -e "${BLUE}Starting PostgreSQL...${NC}"
      docker run -d \
        --name ddalab-broker-postgres \
        -e POSTGRES_DB=ddalab_broker \
        -e POSTGRES_USER=ddalab \
        -e POSTGRES_PASSWORD=test_password \
        -p 5432:5432 \
        postgres:16-alpine

      echo "Waiting for PostgreSQL to be ready..."
      sleep 3
    fi

    echo -e "${BLUE}Starting broker in watch mode...${NC}"
    export DATABASE_URL="postgres://ddalab:test_password@localhost:5432/ddalab_broker"
    export RUST_LOG="ddalab_broker=debug,tower_http=debug"

    # Use cargo-watch if available, otherwise regular run
    if command -v cargo-watch &> /dev/null; then
      cargo watch -x run
    else
      echo -e "${YELLOW}Tip: Install cargo-watch for auto-reload: cargo install cargo-watch${NC}"
      cargo run
    fi
    ;;

  clean)
    echo -e "${YELLOW}Cleaning up...${NC}"
    docker-compose down -v
    # Remove standalone postgres container and its volume
    if docker ps -a | grep -q ddalab-broker-postgres; then
      docker stop ddalab-broker-postgres 2>/dev/null || true
      docker rm -v ddalab-broker-postgres 2>/dev/null || true
    fi
    cargo clean
    echo -e "${GREEN}✅ Cleaned up${NC}"
    ;;

  help|*)
    echo -e "${BLUE}DDALAB Sync Broker - Development Helper${NC}"
    echo ""
    echo "Usage: ./dev.sh <command>"
    echo ""
    echo "Commands:"
    echo "  start      Start broker with Docker Compose"
    echo "  stop       Stop broker"
    echo "  restart    Restart broker"
    echo "  logs       View broker logs (follow)"
    echo "  db         Connect to PostgreSQL CLI"
    echo "  test       Run test script"
    echo "  build      Build release binary"
    echo "  run        Run broker locally (needs local PostgreSQL)"
    echo "  dev        Start PostgreSQL + run broker in watch mode"
    echo "  clean      Remove all containers and build artifacts"
    echo "  help       Show this help"
    echo ""
    echo "Examples:"
    echo "  ./dev.sh start          # Start with Docker Compose"
    echo "  ./dev.sh dev            # Development with auto-reload"
    echo "  ./dev.sh logs           # Watch logs"
    echo "  ./dev.sh test           # Run tests"
    ;;
esac
