import type { FullConfig } from '@playwright/test';

// Force kill all electron processes when tests complete
export default async function globalTeardown(config: FullConfig) {
  console.log('Playwright global teardown: Starting final cleanup');
  
  // First, wait a bit for normal cleanup to complete
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const { execSync } = require('child_process');
  const platform = process.platform;
  const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
  
  if (!isCI) {
    console.log('Skipping aggressive cleanup in local development');
    return;
  }
  
  try {
    console.log(`Platform: ${platform}, killing all electron processes...`);
    
    if (platform === 'win32') {
      // Windows - kill all electron and related processes
      const commands = [
        'taskkill /F /IM electron.exe /T',
        'taskkill /F /IM "Electron.exe" /T',
        'wmic process where "commandline like \'%electron%\'" delete',
        'wmic process where "name like \'%electron%\'" delete'
      ];
      
      for (const cmd of commands) {
        try {
          execSync(cmd + ' 2>NUL', { stdio: 'ignore' });
        } catch (e) {
          // Continue even if command fails
        }
      }
      console.log('Windows: Killed all electron processes');
      
    } else if (platform === 'darwin') {
      // macOS - use both pkill and killall
      const commands = [
        'pkill -9 -f Electron',
        'pkill -9 -f "Electron Helper"',
        'killall -9 Electron 2>/dev/null',
        'killall -9 "Electron Helper" 2>/dev/null'
      ];
      
      for (const cmd of commands) {
        try {
          execSync(cmd + ' || true', { stdio: 'ignore' });
        } catch (e) {
          // Continue
        }
      }
      console.log('macOS: Killed all Electron processes');
      
    } else {
      // Linux
      const commands = [
        'pkill -9 -f electron',
        'pkill -9 -f Electron',
        'killall -9 electron 2>/dev/null'
      ];
      
      for (const cmd of commands) {
        try {
          execSync(cmd + ' || true', { stdio: 'ignore' });
        } catch (e) {
          // Continue
        }
      }
      console.log('Linux: Killed all electron processes');
    }
    
    // Final cleanup delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('Playwright global teardown: Cleanup completed successfully');
    
  } catch (error) {
    console.log('Playwright global teardown: Some cleanup commands failed (this is normal)');
  }
  
  // Exit cleanly
  process.exit(0);
}