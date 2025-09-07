/**
 * Global teardown for Playwright tests
 * This runs after all tests have completed and helps ensure proper cleanup
 */

export default async function globalTeardown() {
  console.log('Global teardown: Starting cleanup process...');
  
  const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
  const isLinux = process.platform === 'linux';
  
  try {
    // In CI, we need ultra-aggressive cleanup across all platforms
    if (isCI) {
      console.log('CI environment detected, performing ultra-aggressive cleanup');
      
      // Kill any remaining Electron processes that might be hanging across all platforms
      try {
        const { execSync } = require('child_process');
        
        if (process.platform === 'win32') {
          // Windows: Kill all electron processes
          execSync('taskkill /F /IM electron.exe /T 2>NUL || echo "No electron processes"', { stdio: 'ignore' });
          execSync('taskkill /F /IM node.exe /FI "WINDOWTITLE eq *electron*" /T 2>NUL || echo "No electron node"', { stdio: 'ignore' });
          execSync('taskkill /F /IM node.exe /FI "COMMANDLINE eq *configmanager*" /T 2>NUL || echo "No configmanager processes"', { stdio: 'ignore' });
          console.log('Windows: Killed any remaining electron/node processes');
        } else {
          // Linux/macOS: Kill electron processes with extreme prejudice
          execSync('pkill -9 -f electron || true', { stdio: 'ignore' });
          execSync('pkill -9 -f "configmanager.*dist.*main" || true', { stdio: 'ignore' });
          execSync('pkill -9 -f "npm.*test" || true', { stdio: 'ignore' });
          execSync('pkill -9 -f playwright || true', { stdio: 'ignore' });
          console.log('Unix: Killed any remaining electron/test processes');
        }
      } catch (error) {
        console.log('Process cleanup failed but continuing:', error instanceof Error ? error.message : String(error));
      }
      
      // Very short delay in CI to finish quickly
      await new Promise(resolve => setTimeout(resolve, 200));
    } else {
      // Longer delay for local development
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Try to force garbage collection if available (without --expose-gc flag)
    try {
      if (typeof global !== 'undefined' && global.gc) {
        for (let i = 0; i < 3; i++) {
          global.gc();
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.log('Forced garbage collection completed');
      } else {
        // Alternative memory pressure relief without --expose-gc
        const memBefore = process.memoryUsage().heapUsed;
        for (let i = 0; i < 5; i++) {
          // Create and release some objects to encourage GC
          let temp = new Array(1000).fill(null);
          temp = null;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const memAfter = process.memoryUsage().heapUsed;
        console.log(`Memory cleanup attempt: ${memBefore} -> ${memAfter} bytes`);
      }
    } catch (error) {
      console.log('Memory cleanup skipped:', error instanceof Error ? error.message : String(error));
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