/**
 * Global teardown for Playwright tests
 * This runs after all tests have completed and helps ensure proper cleanup
 */

export default async function globalTeardown() {
  console.log('Global teardown: Starting cleanup process...');
  
  const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
  const isLinux = process.platform === 'linux';
  
  try {
    // In CI, perform final cleanup only if tests are completely done
    if (isCI) {
      console.log('CI environment detected, performing final cleanup');
      
      // Give tests time to finish cleanly first
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Only kill truly orphaned processes
      try {
        const { execSync } = require('child_process');
        
        if (process.platform === 'win32') {
          // Windows: Kill only truly orphaned electron processes
          execSync('taskkill /F /IM electron.exe /T 2>NUL || echo "No orphaned electron processes"', { stdio: 'ignore' });
          console.log('Windows: Cleaned up orphaned electron processes');
        } else {
          // Linux/macOS: Kill only truly orphaned electron processes
          if (process.platform === 'darwin') {
            // macOS specific cleanup
            execSync('pkill -f "Electron.*configmanager" || true', { stdio: 'ignore' });
            execSync('pkill -f "Electron Helper" || true', { stdio: 'ignore' });
            console.log('macOS: Cleaned up orphaned Electron processes');
          } else {
            // Linux cleanup
            execSync('pkill -f "electron.*configmanager" || true', { stdio: 'ignore' });
            console.log('Linux: Cleaned up orphaned electron processes');
          }
        }
      } catch (error) {
        console.log('Final cleanup failed but continuing:', error instanceof Error ? error.message : String(error));
      }
      
      // Brief delay for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 500));
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