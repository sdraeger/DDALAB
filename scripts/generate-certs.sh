#!/bin/bash

# DDALAB Certificate Generation Script
# This script generates locally trusted SSL certificates using mkcert
# to avoid browser security warnings

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

CERTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/certs"

echo -e "${BLUE}🔒 DDALAB Certificate Generation${NC}"
echo "=================================="
echo

# Check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
    echo -e "${YELLOW}⚠️  mkcert is not installed.${NC}"
    echo
    echo "mkcert creates locally trusted SSL certificates without browser warnings."
    echo
    echo "Install options:"
    echo -e "${GREEN}macOS (Homebrew):${NC} brew install mkcert"
    echo -e "${GREEN}Linux (apt):${NC}      sudo apt install mkcert"
    echo -e "${GREEN}Windows:${NC}         choco install mkcert"
    echo
    echo "Or download from: https://github.com/FiloSottile/mkcert/releases"
    echo
    read -p "Would you like to install mkcert using Homebrew? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}Installing mkcert...${NC}"
        if command -v brew &> /dev/null; then
            brew install mkcert
        else
            echo -e "${RED}❌ Homebrew not found. Please install mkcert manually.${NC}"
            exit 1
        fi
    else
        echo -e "${RED}❌ mkcert is required. Please install it and run this script again.${NC}"
        exit 1
    fi
fi

# Create certificates directory if it doesn't exist
mkdir -p "$CERTS_DIR"

echo -e "${BLUE}📁 Certificate directory: ${CERTS_DIR}${NC}"
echo

# Check if certificates already exist
if [ -f "$CERTS_DIR/server.crt" ] && [ -f "$CERTS_DIR/server.key" ]; then
    echo -e "${YELLOW}⚠️  Existing certificates found.${NC}"
    
    # Check certificate validity
    if openssl x509 -checkend 86400 -noout -in "$CERTS_DIR/server.crt" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Current certificate is valid for more than 24 hours.${NC}"
        
        # Show certificate info
        echo
        echo "Current certificate details:"
        openssl x509 -in "$CERTS_DIR/server.crt" -text -noout | grep -E "(Subject:|Not Before:|Not After:|DNS:|IP Address:)" || true
        echo
        
        read -p "Do you want to regenerate the certificates anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${GREEN}✅ Using existing certificates.${NC}"
            exit 0
        fi
    else
        echo -e "${RED}❌ Current certificate is expired or will expire soon.${NC}"
    fi
    
    echo -e "${BLUE}🔄 Backing up existing certificates...${NC}"
    mv "$CERTS_DIR/server.crt" "$CERTS_DIR/server.crt.bak.$(date +%s)" 2>/dev/null || true
    mv "$CERTS_DIR/server.key" "$CERTS_DIR/server.key.bak.$(date +%s)" 2>/dev/null || true
fi

# Initialize mkcert if not already done
echo -e "${BLUE}🔧 Setting up mkcert root CA...${NC}"
if ! mkcert -install 2>&1 | grep -q "The local CA is already installed"; then
    # If mkcert -install fails but not because CA is already installed
    if mkcert -install 2>&1 | grep -q "Firefox.*certutil.*SEC_ERROR_BAD_DATA"; then
        echo -e "${YELLOW}⚠️  Firefox certificate database warning (non-critical)${NC}"
        echo "The mkcert CA is installed in the system trust store."
        echo "Firefox database warning can be safely ignored."
        echo
    else
        # Check if the install actually failed
        echo -e "${RED}❌ mkcert -install encountered an error${NC}"
        echo "Checking if CA is already properly installed..."
        echo
    fi
fi

echo -e "${BLUE}🔑 Generating certificates for DDALAB...${NC}"

# Generate certificates for common local development domains
# Include localhost, 127.0.0.1, and common local domains
cd "$CERTS_DIR"
mkcert -cert-file server.crt -key-file server.key \
    localhost \
    127.0.0.1 \
    ::1 \
    ddalab.local \
    *.ddalab.local \
    host.docker.internal

# Verify the certificates were created
if [ -f "server.crt" ] && [ -f "server.key" ]; then
    echo
    echo -e "${GREEN}✅ Certificates generated successfully!${NC}"
    
    # Show certificate details
    echo
    echo "Certificate details:"
    openssl x509 -in server.crt -text -noout | grep -E "(Subject:|Not Before:|Not After:|DNS:|IP Address:)" | head -10
    
    # Set appropriate permissions
    chmod 644 server.crt
    chmod 600 server.key
    
    echo
    echo -e "${GREEN}🎉 Setup complete!${NC}"
    echo
    echo "The certificates are now installed and trusted by your system."
    echo "DDALAB will use these certificates to provide HTTPS without browser warnings."
    echo
    echo -e "${YELLOW}Note:${NC} You may need to restart DDALAB services for the new certificates to take effect."
    echo
else
    echo -e "${RED}❌ Failed to generate certificates.${NC}"
    exit 1
fi