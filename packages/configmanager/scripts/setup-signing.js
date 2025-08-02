const fs = require("fs");
const path = require("path");

function setupSigning(environment = "development") {
  console.log(`Setting up code signing for ${environment} environment...`);

  const configs = {
    development: {
      mac: {
        identity: null,
        hardenedRuntime: false,
        gatekeeperAssess: false,
        entitlements: null,
        entitlementsInherit: null,
      },
      win: {
        certificateFile: null,
        certificatePassword: null,
        rfc3161TimeStampServer: null,
        timeStampServer: null,
      },
    },
    beta: {
      mac: {
        identity: null,
        hardenedRuntime: false,
        gatekeeperAssess: false,
        entitlements: null,
        entitlementsInherit: null,
      },
      win: {
        certificateFile: null,
        certificatePassword: null,
        rfc3161TimeStampServer: null,
        timeStampServer: null,
      },
    },
    production: {
      mac: {
        identity:
          process.env.CSC_IDENTITY ||
          "Developer ID Application: Your Name (TEAM_ID)",
        hardenedRuntime: process.env.CSC_HARDENED_RUNTIME === "true",
        gatekeeperAssess: process.env.CSC_GATEKEEPER_ASSESS === "true",
        entitlements: "build/entitlements.mac.plist",
        entitlementsInherit: "build/entitlements.mac.inherit.plist",
      },
      win: {
        certificateFile:
          process.env.CSC_LINK || "certificates/code-signing.pfx",
        certificatePassword: process.env.CSC_KEY_PASSWORD,
        rfc3161TimeStampServer: "http://timestamp.digicert.com",
        timeStampServer: "http://timestamp.digicert.com",
      },
    },
  };

  const config = configs[environment];
  if (!config) {
    console.error(`Unknown environment: ${environment}`);
    console.log("Available environments: development, beta, production");
    process.exit(1);
  }

  // Update development config
  const devConfigPath = path.join(__dirname, "../electron-builder.dev.json");
  const devConfig = JSON.parse(fs.readFileSync(devConfigPath, "utf8"));

  devConfig.mac = { ...devConfig.mac, ...config.mac };
  devConfig.win = { ...devConfig.win, ...config.win };

  fs.writeFileSync(devConfigPath, JSON.stringify(devConfig, null, 2) + "\n");
  console.log(`Updated ${devConfigPath}`);

  // Update beta config
  const betaConfigPath = path.join(__dirname, "../electron-builder.beta.json");
  const betaConfig = JSON.parse(fs.readFileSync(betaConfigPath, "utf8"));

  betaConfig.mac = { ...betaConfig.mac, ...config.mac };
  betaConfig.win = { ...betaConfig.win, ...config.win };

  fs.writeFileSync(betaConfigPath, JSON.stringify(betaConfig, null, 2) + "\n");
  console.log(`Updated ${betaConfigPath}`);

  // Update production config in package.json
  const packagePath = path.join(__dirname, "../package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

  if (!packageJson.build) {
    packageJson.build = {};
  }

  packageJson.build.mac = { ...packageJson.build.mac, ...config.mac };
  packageJson.build.win = { ...packageJson.build.win, ...config.win };

  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n");
  console.log(`Updated ${packagePath}`);

  console.log(`\nCode signing setup complete for ${environment} environment.`);

  if (environment === "production") {
    console.log("\nProduction signing requires:");
    console.log("- Valid Apple Developer certificate for macOS");
    console.log("- Valid code signing certificate for Windows");
    console.log("- Environment variables set:");
    console.log(
      "  export CSC_IDENTITY='Developer ID Application: Your Name (TEAM_ID)'"
    );
    console.log("  export CSC_HARDENED_RUNTIME=true");
    console.log("  export CSC_GATEKEEPER_ASSESS=true");
    console.log("  export CSC_KEY_PASSWORD=your_password");
    console.log("  export CSC_LINK=path/to/certificate.pfx");
  }
}

function checkCertificates() {
  console.log("Checking available code signing certificates...");

  const { execSync } = require("child_process");

  try {
    const result = execSync("security find-identity -v -p codesigning", {
      encoding: "utf8",
    });
    console.log(result);
  } catch (error) {
    console.log("No valid code signing certificates found.");
    console.log(
      "For development, this is expected and builds will skip signing."
    );
  }
}

function showHelp() {
  console.log(`
Code Signing Setup Script

Usage:
  node scripts/setup-signing.js [environment]

Environments:
  development  - No code signing (default)
  beta         - No code signing
  production   - Full code signing

Examples:
  node scripts/setup-signing.js development
  node scripts/setup-signing.js production

Commands:
  node scripts/setup-signing.js check    - Check available certificates
  node scripts/setup-signing.js help     - Show this help
`);
}

const command = process.argv[2];

if (command === "check") {
  checkCertificates();
} else if (command === "help" || command === "--help" || command === "-h") {
  showHelp();
} else {
  const environment = command || "development";
  setupSigning(environment);
}
