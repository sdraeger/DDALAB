import { FullConfig } from '@playwright/test';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

async function globalSetup(config: FullConfig) {
  console.log('🚀 DDALAB Orchestrator E2E Global Setup');
  
  const platform = process.platform;
  const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
  
  console.log(`Platform: ${platform}`);
  console.log(`CI Environment: ${isCI}`);
  
  // Check system requirements
  console.log('📋 Checking system requirements...');
  
  try {
    // Check Node.js
    const { stdout: nodeVersion } = await execAsync('node --version');
    console.log(`✅ Node.js: ${nodeVersion.trim()}`);
  } catch (error) {
    console.error('❌ Node.js not found');
  }
  
  try {
    // Check Docker
    const { stdout: dockerVersion } = await execAsync('docker --version');
    console.log(`✅ Docker: ${dockerVersion.trim()}`);
    
    // Check if Docker is running
    try {
      await execAsync('docker info');
      console.log('✅ Docker is running');
      process.env.DDALAB_DOCKER_AVAILABLE = 'true';
    } catch (error) {
      console.log('⚠️ Docker is installed but not running');
      process.env.DDALAB_DOCKER_AVAILABLE = 'false';
    }
  } catch (error) {
    console.log('❌ Docker not found');
    process.env.DDALAB_DOCKER_AVAILABLE = 'false';
  }
  
  // Clean up any existing test containers
  if (process.env.DDALAB_DOCKER_AVAILABLE === 'true') {
    console.log('🧹 Cleaning up existing DDALAB containers...');
    try {
      await execAsync('docker-compose down -v 2>/dev/null || true');
      await execAsync('docker container prune -f 2>/dev/null || true');
    } catch (error) {
      // Ignore cleanup errors
    }
  }
  
  // Set test environment variables
  process.env.ELECTRON_IS_TESTING = 'true';
  process.env.ELECTRON_DISABLE_SANDBOX = '1';
  process.env.NODE_ENV = 'test';
  process.env.DDALAB_E2E_PLATFORM = platform;
  
  console.log('✅ Global setup complete\n');
}

export default globalSetup;