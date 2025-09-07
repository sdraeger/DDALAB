/**
 * Global teardown for Playwright tests
 * This runs after all tests have completed and helps ensure proper cleanup
 */

export default async function globalTeardown() {
  console.log('Global teardown: Starting cleanup process...');
  
  const isCI = process.env.CI === 'true' || process.env.CIRCLECI === 'true';
  
  // Use shorter cleanup time in CI to avoid timeouts
  const cleanupDelay = isCI ? 2000 : 5000;
  
  // Give time for any remaining processes to clean up
  await new Promise(resolve => setTimeout(resolve, cleanupDelay));
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  console.log('Global teardown: Cleanup completed');
}