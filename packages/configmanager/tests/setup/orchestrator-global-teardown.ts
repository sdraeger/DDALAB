import { FullConfig } from '@playwright/test';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

async function globalTeardown(config: FullConfig) {
  console.log('\n🧹 DDALAB Orchestrator E2E Global Teardown');
  
  const dockerAvailable = process.env.DDALAB_DOCKER_AVAILABLE === 'true';
  const isWindows = process.platform === 'win32';
  const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
  
  // Set shorter timeouts for Windows CI
  const cleanupTimeout = isWindows && isCI ? 30000 : 60000;
  
  if (dockerAvailable) {
    console.log('🐳 Cleaning up Docker resources...');
    
    try {
      // Use Promise.race to enforce timeout
      await Promise.race([
        (async () => {
          // Stop any running DDALAB containers
          const { stdout } = await execAsync('docker ps -q --filter "name=ddalab"');
          const containerIds = stdout.trim().split('\n').filter(id => id.length > 0);
          
          if (containerIds.length > 0) {
            console.log(`Stopping ${containerIds.length} DDALAB containers...`);
            await execAsync(`docker stop ${containerIds.join(' ')}`);
            await execAsync(`docker rm ${containerIds.join(' ')}`);
          }
          
          // Clean up networks and volumes created during testing
          await execAsync('docker network prune -f 2>/dev/null || true');
          await execAsync('docker volume prune -f 2>/dev/null || true');
        })(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Docker cleanup timeout')), cleanupTimeout)
        )
      ]);
      
      console.log('✅ Docker cleanup complete');
      
    } catch (error) {
      console.log('⚠️ Docker cleanup had some issues or timed out (this is usually okay)');
    }
  }
  
  // Clean up test artifacts
  console.log('📁 Cleaning up test artifacts...');
  try {
    // Use Promise.race for artifact cleanup too
    await Promise.race([
      (async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        
        // Clean up any temporary files created during tests
        const tempDirs = [
          'test-results',
          'playwright-report',
          'test-artifacts'
        ];
        
        for (const dir of tempDirs) {
          try {
            const fullPath = path.resolve(process.cwd(), dir);
            await fs.rm(fullPath, { recursive: true, force: true });
          } catch (error) {
            // Ignore if directories don't exist
          }
        }
      })(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Artifact cleanup timeout')), 10000)
      )
    ]);
    
  } catch (error) {
    console.log('⚠️ Could not clean up all test artifacts or cleanup timed out');
  }
  
  // Platform-specific process cleanup for orchestrator tests
  if ((process.platform === 'linux' || process.platform === 'darwin') && isCI) {
    const platform = process.platform === 'darwin' ? 'macOS' : 'Linux';
    console.log(`🐧 ${platform}: Performing final process cleanup...`);
    try {
      await Promise.race([
        (async () => {
          // Kill any remaining electron processes that might cause worker hangs
          if (process.platform === 'darwin') {
            // macOS specific patterns
            await execAsync('pkill -f "Electron.*configmanager" || true');
            await execAsync('pkill -f "Electron Helper" || true');
            await execAsync('pkill -f "Electron.*main.js" || true');
          } else {
            // Linux patterns
            await execAsync('pkill -f "electron.*configmanager" || true');
            await execAsync('pkill -f "electron.*main.js" || true');
          }
          console.log(`${platform}: Electron processes cleaned up`);
        })(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`${platform} process cleanup timeout`)), 5000)
        )
      ]);
    } catch (error) {
      console.log(`⚠️ ${platform} process cleanup completed with some issues (this is usually okay)`);
    }
  }
  
  console.log('✅ Global teardown complete');
}

export default globalTeardown;