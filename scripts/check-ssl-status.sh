#!/bin/bash

# DDALAB SSL Certificate Status Checker
# This script displays the current SSL certificate status

CERTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/certs"
CERT_FILE="$CERTS_DIR/server.crt"
KEY_FILE="$CERTS_DIR/server.key"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔒 DDALAB SSL Certificate Status${NC}"
echo "=================================="

# Check if certificate files exist
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
    echo -e "${RED}❌ SSL certificates not found${NC}"
    echo "Expected location: $CERTS_DIR"
    echo
    echo "To generate SSL certificates:"
    echo "1. Use Config Manager: 🔒 Manage SSL Certificates"
    echo "2. Or run: ./scripts/generate-certs.sh"
    exit 1
fi

# Check certificate validity
if ! openssl x509 -checkend 86400 -noout -in "$CERT_FILE" >/dev/null 2>&1; then
    echo -e "${RED}❌ SSL certificate is expired or will expire within 24 hours${NC}"
    echo
    echo "To renew certificates:"
    echo "1. Use Config Manager: 🔒 Manage SSL Certificates"
    echo "2. Or run: ./scripts/generate-certs.sh"
    exit 1
fi

# Get certificate details
echo -e "${GREEN}✅ SSL certificates found and valid${NC}"
echo

# Extract certificate information
CERT_SUBJECT=$(openssl x509 -in "$CERT_FILE" -noout -subject 2>/dev/null | sed 's/subject=//')
CERT_ISSUER=$(openssl x509 -in "$CERT_FILE" -noout -issuer 2>/dev/null | sed 's/issuer=//')
CERT_NOT_AFTER=$(openssl x509 -in "$CERT_FILE" -noout -dates 2>/dev/null | grep notAfter | sed 's/notAfter=//')

echo "Certificate Details:"
echo "Subject: $CERT_SUBJECT"
echo "Issuer: $CERT_ISSUER"
echo "Expires: $CERT_NOT_AFTER"

# Check if it's a trusted certificate (mkcert)
if echo "$CERT_ISSUER" | grep -q "mkcert"; then
    echo -e "${GREEN}🎉 Trusted certificate (no browser warnings)${NC}"
else
    echo -e "${YELLOW}⚠️  Self-signed certificate (browsers will show warnings)${NC}"
    echo
    echo "For a better experience without browser warnings:"
    echo "1. Install mkcert: brew install mkcert"
    echo "2. Generate trusted certificates: ./scripts/generate-certs.sh"
fi

echo
echo "DDALAB will be available at: https://localhost"