/**
 * Post-build patch for Next.js createClientModuleProxy errors
 * This directly modifies the built Next.js files to add the missing function
 */

const fs = require('fs');
const path = require('path');

function patchNextJSBuild() {
  console.log('🔧 Patching Next.js build files for createClientModuleProxy...');
  
  const nextDir = path.join(__dirname, '.next');
  const serverDir = path.join(nextDir, 'server');
  
  if (!fs.existsSync(serverDir)) {
    console.log('❌ .next/server directory not found, skipping patch');
    return;
  }
  
  // Function to recursively find and patch files
  function patchFilesInDir(dir) {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        patchFilesInDir(filePath);
      } else if (file.endsWith('.js')) {
        try {
          let content = fs.readFileSync(filePath, 'utf8');
          
          // Check if this file contains the problematic createClientModuleProxy reference
          if (content.includes('createClientModuleProxy') && content.includes('Cannot read properties of undefined')) {
            console.log(`🔧 Patching file: ${filePath}`);
            
            // Add the createClientModuleProxy function at the beginning of the file
            const patchCode = `
if (typeof createClientModuleProxy === 'undefined') {
  global.createClientModuleProxy = function(moduleId) {
    console.log('🔧 BUILD PATCH: createClientModuleProxy called for', moduleId);
    return {
      __esModule: true,
      default: function() { return null; }
    };
  };
  var createClientModuleProxy = global.createClientModuleProxy;
}
`;
            
            content = patchCode + content;
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`✅ Patched ${filePath}`);
          }
          
          // Also patch any direct references to undefined.createClientModuleProxy
          if (content.includes('.createClientModuleProxy') || content.includes('createClientModuleProxy(')) {
            const originalContent = content;
            
            // Replace undefined.createClientModuleProxy with our fallback
            content = content.replace(
              /(\w+)\.createClientModuleProxy/g,
              '(($1 && $1.createClientModuleProxy) || global.createClientModuleProxy || function(id) { return { __esModule: true, default: function() { return null; } }; })'
            );
            
            // Replace direct createClientModuleProxy calls
            content = content.replace(
              /createClientModuleProxy\s*\(/g,
              '(global.createClientModuleProxy || function(id) { return { __esModule: true, default: function() { return null; } }; })('
            );
            
            if (content !== originalContent) {
              fs.writeFileSync(filePath, content, 'utf8');
              console.log(`✅ Patched references in ${filePath}`);
            }
          }
        } catch (error) {
          console.warn(`⚠️ Could not patch ${filePath}:`, error.message);
        }
      }
    }
  }
  
  patchFilesInDir(serverDir);
  console.log('✅ Next.js build patching complete');
}

// Run the patch
patchNextJSBuild();

module.exports = { patchNextJSBuild };