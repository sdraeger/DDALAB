/**
 * Global teardown for Playwright tests
 * This runs after all tests have completed and helps ensure proper cleanup
 */

export default async function globalTeardown() {
  console.log('Global teardown: Starting cleanup process...');
  
  // Give extra time for any remaining processes to clean up
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  console.log('Global teardown: Cleanup completed');
}