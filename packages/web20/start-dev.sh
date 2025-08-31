#!/bin/bash
# Start Next.js with proper HTTPS configuration for development

export NODE_TLS_REJECT_UNAUTHORIZED=0
export NEXT_PUBLIC_API_URL=https://localhost/api
export NEXTAUTH_URL=https://localhost

# Start Next.js
npm run dev
