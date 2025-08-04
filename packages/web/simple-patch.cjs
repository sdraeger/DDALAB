/**
 * Simple Direct Patch for createClientModuleProxy
 * Directly replaces problematic code in built files
 */

const fs = require('fs');
const path = require('path');

function applySimplePatch() {
  console.log('🔧 Applying simple createClientModuleProxy patch...');

  const serverChunksDir = path.join(__dirname, '.next', 'server', 'chunks');
  const serverAppDir = path.join(__dirname, '.next', 'server', 'app');

  const dirsToCheck = [serverChunksDir, serverAppDir].filter(dir => fs.existsSync(dir));

  for (const dir of dirsToCheck) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      if (file.endsWith('.js')) {
        const filePath = path.join(dir, file);

        try {
          let content = fs.readFileSync(filePath, 'utf8');

          // Simple replacement of the problematic pattern
          const problematicPattern = /\.createClientModuleProxy\s*\(/g;

          if (problematicPattern.test(content)) {
            console.log(`🔧 Found createClientModuleProxy pattern in ${file}`);

            // Replace with safe fallback
            content = content.replace(
              /(\w+)\.createClientModuleProxy\s*\(/g,
              '(($1 && $1.createClientModuleProxy) || (() => ({__esModule:true,default:()=>null})))('
            );

            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`✅ Patched ${file}`);
          }
        } catch (error) {
          console.warn(`⚠️ Could not patch ${file}:`, error.message);
        }
      }
    }
  }

  console.log('✅ Simple patch complete');
}

applySimplePatch();
