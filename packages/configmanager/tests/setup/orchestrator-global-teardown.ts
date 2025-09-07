import { FullConfig } from '@playwright/test';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

async function globalTeardown(config: FullConfig) {
  console.log('\n🧹 DDALAB Orchestrator E2E Global Teardown');
  
  const dockerAvailable = process.env.DDALAB_DOCKER_AVAILABLE === 'true';
  
  if (dockerAvailable) {
    console.log('🐳 Cleaning up Docker resources...');
    
    try {
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
      
      console.log('✅ Docker cleanup complete');
      
    } catch (error) {
      console.log('⚠️ Docker cleanup had some issues (this is usually okay)');
    }
  }
  
  // Clean up test artifacts
  console.log('📁 Cleaning up test artifacts...');
  try {
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
    
  } catch (error) {
    console.log('⚠️ Could not clean up all test artifacts');
  }
  
  console.log('✅ Global teardown complete');
}

export default globalTeardown;