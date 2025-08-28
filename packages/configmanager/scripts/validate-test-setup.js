#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 Validating ConfigManager test setup...\n');

const checks = [];

// Check if package.json has test scripts
const packageJsonPath = path.join(__dirname, '../package.json');
if (fs.existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  if (packageJson.scripts && packageJson.scripts['test:e2e']) {
    checks.push({ name: 'Test scripts in package.json', status: '✅', details: 'test:e2e script found' });
  } else {
    checks.push({ name: 'Test scripts in package.json', status: '❌', details: 'Missing test:e2e script' });
  }
  
  if (packageJson.devDependencies && packageJson.devDependencies['@playwright/test']) {
    checks.push({ name: 'Playwright dependency', status: '✅', details: `Version ${packageJson.devDependencies['@playwright/test']}` });
  } else {
    checks.push({ name: 'Playwright dependency', status: '❌', details: 'Playwright not found in devDependencies' });
  }
} else {
  checks.push({ name: 'package.json exists', status: '❌', details: 'package.json not found' });
}

// Check if playwright.config.ts exists
const playwrightConfigPath = path.join(__dirname, '../playwright.config.ts');
if (fs.existsSync(playwrightConfigPath)) {
  checks.push({ name: 'Playwright configuration', status: '✅', details: 'playwright.config.ts found' });
} else {
  checks.push({ name: 'Playwright configuration', status: '❌', details: 'playwright.config.ts not found' });
}

// Check if test directory exists and has test files
const testDir = path.join(__dirname, '../tests');
if (fs.existsSync(testDir)) {
  const testFiles = fs.readdirSync(testDir).filter(file => file.endsWith('.spec.ts'));
  if (testFiles.length > 0) {
    checks.push({ name: 'Test files', status: '✅', details: `Found ${testFiles.length} test files` });
  } else {
    checks.push({ name: 'Test files', status: '❌', details: 'No .spec.ts files found in tests directory' });
  }
  
  // Check for virtualization setup
  const mockEnvPath = path.join(testDir, 'setup/mock-environment.ts');
  if (fs.existsSync(mockEnvPath)) {
    checks.push({ name: 'Test virtualization', status: '✅', details: 'Mock environment setup found' });
  } else {
    checks.push({ name: 'Test virtualization', status: '❌', details: 'Mock environment setup not found' });
  }
  
  const electronUtilsPath = path.join(testDir, 'utils/electron-utils.ts');
  if (fs.existsSync(electronUtilsPath)) {
    const utilsContent = fs.readFileSync(electronUtilsPath, 'utf8');
    if (utilsContent.includes('MockEnvironment')) {
      checks.push({ name: 'Electron utils integration', status: '✅', details: 'Virtualization integrated in electron-utils' });
    } else {
      checks.push({ name: 'Electron utils integration', status: '⚠️', details: 'Electron utils may need virtualization integration' });
    }
  }
} else {
  checks.push({ name: 'Test directory', status: '❌', details: 'tests directory not found' });
}

// Check if built app exists
const distPath = path.join(__dirname, '../dist/main.js');
if (fs.existsSync(distPath)) {
  checks.push({ name: 'Built application', status: '✅', details: 'dist/main.js found' });
} else {
  checks.push({ name: 'Built application', status: '⚠️', details: 'dist/main.js not found - run npm run build' });
}

// Display results
console.log('📋 Validation Results:\n');
checks.forEach(check => {
  console.log(`${check.status} ${check.name}: ${check.details}`);
});

// Summary
const passed = checks.filter(c => c.status === '✅').length;
const failed = checks.filter(c => c.status === '❌').length;
const warnings = checks.filter(c => c.status === '⚠️').length;

console.log(`\n📊 Summary: ${passed} passed, ${warnings} warnings, ${failed} failed\n`);

if (failed > 0) {
  console.log('❌ Test setup is incomplete. Please address the failed checks above.');
  process.exit(1);
} else if (warnings > 0) {
  console.log('⚠️  Test setup is mostly complete but has warnings. Consider addressing them.');
  process.exit(0);
} else {
  console.log('✅ Test setup is complete! You can now run tests with: npm run test:e2e');
  process.exit(0);
}