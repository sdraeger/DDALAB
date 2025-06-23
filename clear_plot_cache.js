// Script to clear persistent plot state from localStorage
console.log("Clearing plot-related localStorage entries...");

// Get all localStorage keys
const keys = Object.keys(localStorage);
let clearedCount = 0;

// Clear plot cache entries
keys.forEach(key => {
  if (key.startsWith('plot:') ||
      key.startsWith('heatmap:') ||
      key.startsWith('annotations:') ||
      key === 'persistent-plots' ||
      key.includes('plotState') ||
      key.includes('timeWindow') ||
      key.includes('chunkSize')) {
    console.log(`Removing: ${key}`);
    localStorage.removeItem(key);
    clearedCount++;
  }
});

console.log(`Cleared ${clearedCount} localStorage entries`);
console.log("Cache cleared! Please refresh the page.");
