#!/bin/bash
# Generate SSL certificates for DDALAB

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CERT_DIR="$SCRIPT_DIR/../certs"

# Create certs directory
mkdir -p "$CERT_DIR"

if [ "$1" = "production" ] && [ -n "$2" ]; then
    echo "=== Production Certificate Setup ==="
    echo ""
    echo "For production use, you should obtain proper SSL certificates from:"
    echo "  - Let's Encrypt (free): https://letsencrypt.org"
    echo "  - Your domain registrar"
    echo "  - A certificate authority"
    echo ""
    echo "Once obtained, place your certificates as:"
    echo "  - $CERT_DIR/cert.pem (certificate file)"
    echo "  - $CERT_DIR/key.pem (private key file)"
    echo ""
    echo "For now, generating a self-signed certificate for $2..."
    
    # Generate self-signed cert for the domain
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$CERT_DIR/key.pem" \
        -out "$CERT_DIR/cert.pem" \
        -subj "/C=US/ST=State/L=City/O=DDALAB/CN=$2" \
        2>/dev/null
        
    echo "✓ Self-signed certificate generated for $2"
    echo "  WARNING: This certificate will show security warnings in browsers."
    echo "  Replace with a proper certificate for production use."
else
    echo "Generating self-signed certificate for local development..."
    
    # Generate self-signed certificate with SAN for localhost
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$CERT_DIR/key.pem" \
        -out "$CERT_DIR/cert.pem" \
        -subj "/C=US/ST=State/L=City/O=DDALAB/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1" \
        2>/dev/null || \
    # Fallback for older OpenSSL versions without -addext
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$CERT_DIR/key.pem" \
        -out "$CERT_DIR/cert.pem" \
        -subj "/C=US/ST=State/L=City/O=DDALAB/CN=localhost" \
        2>/dev/null
        
    echo "✓ Self-signed certificate generated successfully"
    echo "  Location: $CERT_DIR/"
    echo "  Files: cert.pem (certificate), key.pem (private key)"
fi

# Set appropriate permissions
chmod 600 "$CERT_DIR/key.pem"
chmod 644 "$CERT_DIR/cert.pem"

echo ""
echo "Certificate generation complete!"