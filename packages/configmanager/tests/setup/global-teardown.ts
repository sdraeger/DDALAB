/**
 * Global teardown for Playwright tests
 * This runs after all tests have completed and helps ensure proper cleanup
 */

export default async function globalTeardown() {
  console.log('Global teardown: Starting cleanup process...');
  
  const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
  const isLinux = process.platform === 'linux';
  
  try {
    // In CI, especially Linux, we need more aggressive cleanup
    if (isCI) {
      console.log('CI environment detected, performing aggressive cleanup');
      
      // Kill any remaining Electron processes that might be hanging
      if (isLinux) {
        try {
          const { execSync } = require('child_process');
          // Kill any electron processes that might be hanging
          execSync('pkill -f electron || true', { stdio: 'ignore' });
          execSync('pkill -f "npm.*test" || true', { stdio: 'ignore' });
          console.log('Killed any remaining electron processes');
        } catch (error) {
          // Ignore errors - processes might already be dead
        }
      }
      
      // Shorter delay in CI to prevent timeout issues
      await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
      // Longer delay for local development
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Force garbage collection multiple times if available
    if (global.gc) {
      for (let i = 0; i < 3; i++) {
        global.gc();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      console.log('Forced garbage collection completed');
    }
    
    // Clear any remaining timers or intervals
    if (typeof clearTimeout !== 'undefined') {
      // Clear high-numbered timer IDs that might be hanging
      for (let i = 1; i < 1000; i++) {
        clearTimeout(i);
        clearInterval(i);
      }
    }
    
  } catch (error) {
    console.log('Error during teardown cleanup:', error instanceof Error ? error.message : String(error));
  }
  
  console.log('Global teardown: Cleanup completed');
}