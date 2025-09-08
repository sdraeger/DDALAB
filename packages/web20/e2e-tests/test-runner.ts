#!/usr/bin/env tsx

/**
 * Test runner script for DDALAB E2E tests
 * This script helps ensure tests run and terminate properly
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

interface TestRunOptions {
  headless?: boolean;
  browser?: string;
  workers?: number;
  retries?: number;
  timeout?: number;
  debug?: boolean;
  ui?: boolean;
}

class TestRunner {
  private projectRoot: string;
  private options: TestRunOptions;

  constructor(options: TestRunOptions = {}) {
    this.projectRoot = path.resolve(__dirname, '..');
    this.options = {
      headless: true,
      browser: 'chromium',
      workers: 1,
      retries: 2,
      timeout: 30000,
      ...options
    };
  }

  async runTests() {
    console.log('🚀 Starting DDALAB E2E Test Suite');
    console.log('Configuration:', this.options);
    
    const startTime = Date.now();
    let success = false;
    
    try {
      // Ensure Playwright browsers are installed
      console.log('📦 Installing Playwright browsers...');
      await this.installBrowsers();
      
      // Check if the application is running
      console.log('🔍 Checking application availability...');
      await this.checkApplicationHealth();
      
      // Run the tests
      console.log('🧪 Running E2E tests...');
      const result = await this.executeTests();
      
      console.log('✅ Tests completed successfully');
      console.log(result);
      success = true;
      
    } catch (error) {
      console.error('❌ Test execution failed:', error);
      success = false;
    } finally {
      const duration = Date.now() - startTime;
      console.log(`⏱️ Total execution time: ${duration}ms`);
      
      // Cleanup
      await this.cleanup();
    }
    
    process.exit(success ? 0 : 1);
  }
  
  private async installBrowsers() {
    try {
      const { stdout, stderr } = await execAsync('npx playwright install', {
        cwd: this.projectRoot,
        timeout: 120000 // 2 minutes
      });
      
      if (stderr) {
        console.warn('Browser install warnings:', stderr);
      }
    } catch (error) {
      console.warn('Browser installation failed, continuing anyway:', error);
    }
  }
  
  private async checkApplicationHealth() {
    const maxRetries = 10;
    const retryInterval = 3000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Health check attempt ${attempt}/${maxRetries}`);
        
        // Simple curl check to see if app is running
        await execAsync('curl -k -f https://localhost || curl -f http://localhost:3000', {
          timeout: 5000
        });
        
        console.log('✅ Application is responding');
        return;
      } catch (error) {
        if (attempt === maxRetries) {
          throw new Error('Application health check failed after maximum retries');
        }
        
        console.log(`⏳ App not ready, waiting ${retryInterval}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
      }
    }
  }
  
  private async executeTests() {
    const command = this.buildTestCommand();
    console.log('Executing command:', command);
    
    const { stdout, stderr } = await execAsync(command, {
      cwd: this.projectRoot,
      timeout: this.options.timeout! * 1000,
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    });
    
    if (stderr) {
      console.warn('Test warnings/errors:', stderr);
    }
    
    return stdout;
  }
  
  private buildTestCommand(): string {
    const args = [
      'npx playwright test',
      '--config=playwright.config.ts'
    ];
    
    if (this.options.headless) {
      args.push('--headed=false');
    }
    
    if (this.options.browser && this.options.browser !== 'all') {
      args.push(`--project=${this.options.browser}`);
    }
    
    if (this.options.workers) {
      args.push(`--workers=${this.options.workers}`);
    }
    
    if (this.options.retries) {
      args.push(`--retries=${this.options.retries}`);
    }
    
    if (this.options.debug) {
      args.push('--debug');
    }
    
    if (this.options.ui) {
      args.push('--ui');
    }
    
    // Add reporter for CI
    if (process.env.CI) {
      args.push('--reporter=junit,html,list');
    }
    
    return args.join(' ');
  }
  
  private async cleanup() {
    console.log('🧹 Performing cleanup...');
    
    try {
      // Kill any hanging browser processes
      if (process.platform === 'darwin' || process.platform === 'linux') {
        await execAsync('pkill -f "chromium|firefox|webkit" || true', { timeout: 5000 });
      }
      
      // Clean up any test artifacts that might be large
      await execAsync('find test-results -name "*.webm" -size +10M -delete || true', {
        cwd: this.projectRoot,
        timeout: 5000
      });
      
    } catch (error) {
      console.warn('Cleanup had some issues:', error);
    }
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const options: TestRunOptions = {};
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--headed':
        options.headless = false;
        break;
      case '--browser':
        options.browser = args[++i];
        break;
      case '--workers':
        options.workers = parseInt(args[++i]);
        break;
      case '--retries':
        options.retries = parseInt(args[++i]);
        break;
      case '--timeout':
        options.timeout = parseInt(args[++i]);
        break;
      case '--debug':
        options.debug = true;
        break;
      case '--ui':
        options.ui = true;
        break;
      case '--help':
        console.log(`
DDALAB E2E Test Runner

Usage: npm run test:e2e [options]

Options:
  --headed          Run tests in headed mode (show browser)
  --browser <name>  Run tests on specific browser (chromium, firefox, webkit)
  --workers <num>   Number of parallel workers (default: 1)
  --retries <num>   Number of retries on failure (default: 2)
  --timeout <ms>    Test timeout in milliseconds (default: 30000)
  --debug           Run in debug mode
  --ui              Open Playwright UI
  --help            Show this help message

Examples:
  npm run test:e2e                    # Run all tests
  npm run test:e2e -- --headed        # Run with visible browser
  npm run test:e2e -- --browser firefox --workers 2
  npm run test:e2e -- --debug         # Debug mode
        `);
        process.exit(0);
        break;
    }
  }
  
  const runner = new TestRunner(options);
  await runner.runTests();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

export { TestRunner };