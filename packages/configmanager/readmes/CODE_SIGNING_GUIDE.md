# Code Signing Guide

This guide explains how to configure code signing for the DDALAB ConfigManager across different platforms and development stages.

## Current Configuration

### Development & Beta Builds (No Code Signing)

The development and beta configurations are set up to **skip code signing**:

```json
{
  "mac": {
    "identity": null,
    "hardenedRuntime": false,
    "gatekeeperAssess": false
  },
  "win": {
    "certificateFile": null,
    "certificatePassword": null
  }
}
```

This is appropriate for:
- Development builds for internal testing
- Beta builds for limited distribution
- When you don't have valid certificates

## Code Signing Options

### Option 1: No Code Signing (Current Setup)

**Pros:**
- No certificate management required
- Faster builds
- Suitable for development and testing

**Cons:**
- macOS Gatekeeper warnings
- Windows SmartScreen warnings
- Users need to manually allow execution

**Usage:**
```bash
# Development builds (no signing)
npm run package:dev
npm run publish:dev

# Beta builds (no signing)
npm run package:dev  # Uses dev config
npm run publish:beta
```

### Option 2: Apple Developer Certificate (macOS)

**Requirements:**
- Apple Developer Account ($99/year)
- Valid Developer ID Application certificate

**Setup:**
1. **Get Apple Developer Certificate:**
   ```bash
   # Check for existing certificates
   security find-identity -v -p codesigning
   
   # If none exist, you need to:
   # 1. Join Apple Developer Program
   # 2. Create certificate in Apple Developer portal
   # 3. Download and install certificate
   ```

2. **Update Configuration:**
   ```json
   {
     "mac": {
       "identity": "Developer ID Application: Your Name (TEAM_ID)",
       "hardenedRuntime": true,
       "gatekeeperAssess": true
     }
   }
   ```

### Option 3: Windows Code Signing Certificate

**Requirements:**
- Code signing certificate from trusted CA
- Certificate file (.pfx or .p12)

**Setup:**
1. **Get Windows Certificate:**
   - Purchase from DigiCert, Sectigo, etc.
   - Or use self-signed for testing

2. **Update Configuration:**
   ```json
   {
     "win": {
       "certificateFile": "path/to/certificate.pfx",
       "certificatePassword": "your_password"
     }
   }
   ```

### Option 4: Environment-Based Configuration

Create different configurations based on environment:

```json
{
  "mac": {
    "identity": "${CSC_IDENTITY}",
    "hardenedRuntime": "${CSC_HARDENED_RUNTIME}",
    "gatekeeperAssess": "${CSC_GATEKEEPER_ASSESS}"
  }
}
```

Then set environment variables:
```bash
# For development (no signing)
export CSC_IDENTITY=null
export CSC_HARDENED_RUNTIME=false
export CSC_GATEKEEPER_ASSESS=false

# For production (with signing)
export CSC_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
export CSC_HARDENED_RUNTIME=true
export CSC_GATEKEEPER_ASSESS=true
```

## Platform-Specific Configuration

### macOS Code Signing

**Development Configuration:**
```json
{
  "mac": {
    "identity": null,
    "hardenedRuntime": false,
    "gatekeeperAssess": false,
    "entitlements": null,
    "entitlementsInherit": null
  }
}
```

**Production Configuration:**
```json
{
  "mac": {
    "identity": "Developer ID Application: Your Name (TEAM_ID)",
    "hardenedRuntime": true,
    "gatekeeperAssess": true,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.inherit.plist"
  }
}
```

### Windows Code Signing

**Development Configuration:**
```json
{
  "win": {
    "certificateFile": null,
    "certificatePassword": null,
    "rfc3161TimeStampServer": null,
    "timeStampServer": null
  }
}
```

**Production Configuration:**
```json
{
  "win": {
    "certificateFile": "certificates/code-signing.pfx",
    "certificatePassword": "${CSC_KEY_PASSWORD}",
    "rfc3161TimeStampServer": "http://timestamp.digicert.com",
    "timeStampServer": "http://timestamp.digicert.com"
  }
}
```

### Linux Code Signing

Linux typically doesn't require code signing, but you can add GPG signing:

```json
{
  "linux": {
    "sign": {
      "gpg": {
        "key": "your-gpg-key-id"
      }
    }
  }
}
```

## Configuration Files

### Development Configuration (`electron-builder.dev.json`)

```json
{
  "mac": {
    "identity": null,
    "hardenedRuntime": false,
    "gatekeeperAssess": false
  },
  "win": {
    "certificateFile": null,
    "certificatePassword": null
  }
}
```

### Production Configuration (`package.json`)

```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name (TEAM_ID)",
      "hardenedRuntime": true,
      "gatekeeperAssess": true
    },
    "win": {
      "certificateFile": "certificates/code-signing.pfx",
      "certificatePassword": "${CSC_KEY_PASSWORD}"
    }
  }
}
```

## Environment Variables

### macOS
```bash
# Disable signing
export CSC_IDENTITY=null
export CSC_HARDENED_RUNTIME=false
export CSC_GATEKEEPER_ASSESS=false

# Enable signing
export CSC_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
export CSC_HARDENED_RUNTIME=true
export CSC_GATEKEEPER_ASSESS=true
```

### Windows
```bash
# Certificate password
export CSC_KEY_PASSWORD=your_password

# Certificate file path
export CSC_LINK=path/to/certificate.pfx
```

## Troubleshooting

### Common Issues

1. **Expired Certificates:**
   ```bash
   # Check certificate validity
   security find-identity -v -p codesigning
   
   # Remove expired certificates
   security delete-identity -Z "expired_certificate_name"
   ```

2. **Gatekeeper Issues:**
   ```bash
   # Allow unsigned apps
   sudo spctl --master-disable
   
   # Check Gatekeeper status
   spctl --status
   ```

3. **Build Failures:**
   ```bash
   # Clean and rebuild
   rm -rf dist/ release-dev/
   npm run build
   npm run package:dev
   ```

### Debug Commands

```bash
# Check available certificates
security find-identity -v -p codesigning

# Check certificate details
security find-certificate -a -c "certificate_name"

# Verify app signature
codesign -dv --verbose=4 /path/to/app

# Check notarization status
xcrun altool --notarization-info [UUID]
```

## Best Practices

### Development
- **Skip code signing** for development builds
- Use environment variables to control signing
- Document signing requirements

### Beta Testing
- **Skip code signing** for beta builds
- Provide clear installation instructions
- Warn users about security prompts

### Production
- **Always use code signing** for production releases
- Use valid certificates from trusted CAs
- Test signed builds thoroughly
- Consider notarization for macOS

## Quick Commands

### Check Signing Status
```bash
# List available certificates
security find-identity -v -p codesigning

# Check app signature
codesign -dv --verbose=4 /path/to/app
```

### Build with Different Signing
```bash
# Development (no signing)
npm run package:dev

# Production (with signing)
npm run package

# Custom signing
CSC_IDENTITY="Your Certificate" npm run package
```

### Environment Setup
```bash
# Development environment
export CSC_IDENTITY=null
export CSC_HARDENED_RUNTIME=false

# Production environment
export CSC_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
export CSC_HARDENED_RUNTIME=true
```

This configuration allows you to build development versions without code signing while maintaining the option to add proper signing for production releases. 