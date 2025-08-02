# Quick Signing Guide

## Current Status: No Code Signing (Development)

Your current setup is configured for **development builds without code signing**, which is appropriate for:

- Development testing
- Beta releases
- When you don't have valid certificates

## Quick Commands

### Check Current Certificates

```bash
npm run check:certificates
```

### Set Up Signing for Different Environments

```bash
# Development (no signing) - Current setup
npm run setup:signing development

# Beta (no signing)
npm run setup:signing beta

# Production (with signing)
npm run setup:signing production
```

### Build with Current Signing Configuration

```bash
# Development builds (no signing)
npm run package:dev

# Production builds (with signing if configured)
npm run package
```

## Changing Signing Accounts

### Option 1: Use Environment Variables (Recommended)

Set environment variables for your signing certificates:

```bash
# macOS
export CSC_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
export CSC_HARDENED_RUNTIME=true
export CSC_GATEKEEPER_ASSESS=true

# Windows
export CSC_KEY_PASSWORD=your_password
export CSC_LINK=path/to/certificate.pfx
```

### Option 2: Update Configuration Files

**For Development/Beta:**

```bash
# Edit electron-builder.dev.json and electron-builder.beta.json
# Set identity: "Your Certificate Name"
```

**For Production:**

```bash
# Edit package.json build section
# Set identity: "Your Certificate Name"
```

### Option 3: Use the Setup Script

```bash
# Set up for production with your certificates
npm run setup:signing production
```

## Certificate Management

### Check Available Certificates

```bash
# List all certificates
security find-identity -v -p codesigning

# Check specific certificate
security find-certificate -a -c "certificate_name"
```

### Remove Expired Certificates

```bash
# Remove specific certificate
security delete-identity -Z "expired_certificate_name"

# List certificates to find expired ones
security find-identity -v -p codesigning
```

### Add New Certificates

**macOS:**

1. Download certificate from Apple Developer portal
2. Double-click to install in Keychain
3. Verify installation: `security find-identity -v -p codesigning`

**Windows:**

1. Purchase certificate from trusted CA (DigiCert, Sectigo, etc.)
2. Export as .pfx file
3. Set environment variables:
   ```bash
   export CSC_LINK=path/to/certificate.pfx
   export CSC_KEY_PASSWORD=your_password
   ```

## Environment-Specific Configurations

### Development (Current)

- **Code Signing**: Disabled
- **Use Case**: Internal testing
- **Build Command**: `npm run package:dev`

### Beta

- **Code Signing**: Disabled
- **Use Case**: Limited distribution
- **Build Command**: `npm run package:dev` (uses dev config)

### Production

- **Code Signing**: Enabled
- **Use Case**: Public releases
- **Build Command**: `npm run package`

## Troubleshooting

### Common Issues

1. **"No valid identities found"**

   ```bash
   # This is expected for development
   # For production, you need valid certificates
   npm run check:certificates
   ```

2. **"Certificate expired"**

   ```bash
   # Remove expired certificate
   security delete-identity -Z "expired_certificate_name"

   # Install new certificate
   # Then update configuration
   npm run setup:signing production
   ```

3. **"Gatekeeper blocked"**

   ```bash
   # Allow unsigned apps (development only)
   sudo spctl --master-disable

   # Check Gatekeeper status
   spctl --status
   ```

### Debug Commands

```bash
# Check certificate validity
security find-identity -v -p codesigning

# Verify app signature
codesign -dv --verbose=4 /path/to/app

# Check build configuration
npm run package:dev -- --verbose
```

## Quick Reference

| Environment | Code Signing | Build Command         | Use Case             |
| ----------- | ------------ | --------------------- | -------------------- |
| Development | Disabled     | `npm run package:dev` | Internal testing     |
| Beta        | Disabled     | `npm run package:dev` | Limited distribution |
| Production  | Enabled      | `npm run package`     | Public releases      |

## Next Steps

### For Development (Current Setup)

- ✅ No changes needed
- ✅ Builds work without signing
- ✅ Users can manually allow execution

### For Production Signing

1. **Get certificates:**

   - Apple Developer Program ($99/year) for macOS
   - Code signing certificate for Windows

2. **Set environment variables:**

   ```bash
   export CSC_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
   export CSC_HARDENED_RUNTIME=true
   export CSC_GATEKEEPER_ASSESS=true
   ```

3. **Update configuration:**

   ```bash
   npm run setup:signing production
   ```

4. **Test signed builds:**
   ```bash
   npm run package
   ```

## Current Configuration Summary

Your configmanager is currently set up for **development without code signing**, which is perfect for:

- ✅ Development and testing
- ✅ Beta releases
- ✅ Internal distribution
- ✅ Faster builds
- ✅ No certificate management

When you're ready for production releases, you can add proper code signing using the steps above.
