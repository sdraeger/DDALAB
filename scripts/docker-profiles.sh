#!/bin/bash
# Docker Compose profile management script

set -e

COMPOSE_FILE="docker-compose.profiles.yml"

function show_help {
    echo "Docker Compose Profile Manager for DDALAB"
    echo ""
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  dev         Start development environment (core + dev services)"
    echo "  prod        Start production environment (core + prod services)"
    echo "  core        Start only core services (postgres, redis, minio)"
    echo "  tools       Start development tools (pgadmin, redis-commander)"
    echo "  monitoring  Start monitoring stack (prometheus, grafana)"
    echo "  all-dev     Start everything for development"
    echo "  stop        Stop all services"
    echo "  clean       Stop all services and remove volumes"
    echo ""
    echo "Examples:"
    echo "  $0 dev              # Start development environment"
    echo "  $0 prod             # Start production environment"
    echo "  $0 all-dev          # Start dev + tools + monitoring"
}

function start_dev {
    echo "Starting development environment..."
    docker compose -f $COMPOSE_FILE --profile dev --profile core up -d
}

function start_prod {
    echo "Starting production environment..."
    docker compose -f $COMPOSE_FILE --profile prod --profile core up -d
}

function start_core {
    echo "Starting core services only..."
    docker compose -f $COMPOSE_FILE --profile core up -d
}

function start_tools {
    echo "Starting development tools..."
    docker compose -f $COMPOSE_FILE --profile dev-tools up -d
}

function start_monitoring {
    echo "Starting monitoring stack..."
    docker compose -f $COMPOSE_FILE --profile monitoring up -d
}

function start_all_dev {
    echo "Starting full development environment..."
    docker compose -f $COMPOSE_FILE --profile dev --profile core --profile dev-tools --profile monitoring up -d
}

function stop_all {
    echo "Stopping all services..."
    docker compose -f $COMPOSE_FILE down
}

function clean_all {
    echo "Stopping all services and removing volumes..."
    read -p "This will delete all data. Are you sure? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]
    then
        docker compose -f $COMPOSE_FILE down -v
    fi
}

case "$1" in
    dev)
        start_dev
        ;;
    prod)
        start_prod
        ;;
    core)
        start_core
        ;;
    tools)
        start_tools
        ;;
    monitoring)
        start_monitoring
        ;;
    all-dev)
        start_all_dev
        ;;
    stop)
        stop_all
        ;;
    clean)
        clean_all
        ;;
    *)
        show_help
        ;;
esac