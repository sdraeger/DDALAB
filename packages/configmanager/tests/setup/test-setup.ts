import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export class TestSetup {
  private static testDataDir: string;
  
  static async initialize() {
    // Create a temporary directory for test data
    this.testDataDir = path.join(os.tmpdir(), 'ddalab-configmanager-tests');
    
    try {
      await fs.mkdir(this.testDataDir, { recursive: true });
    } catch (error) {
      console.warn('Failed to create test data directory:', error);
    }
  }
  
  static async cleanup() {
    if (this.testDataDir) {
      try {
        await fs.rmdir(this.testDataDir, { recursive: true });
      } catch (error) {
        console.warn('Failed to cleanup test data directory:', error);
      }
    }
  }
  
  static getTestDataDir(): string {
    return this.testDataDir || path.join(os.tmpdir(), 'ddalab-configmanager-tests');
  }
  
  static async createTestFile(fileName: string, content: string): Promise<string> {
    const filePath = path.join(this.getTestDataDir(), fileName);
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }
  
  static async createTestEnvFile(): Promise<string> {
    const envContent = `# Test Environment Configuration
NODE_ENV=test
ELECTRON_IS_TESTING=true
TEST_MODE=true
API_URL=http://localhost:3000
DATABASE_URL=test://localhost:5432/test_db
`;
    
    return this.createTestFile('.env.test', envContent);
  }
  
  static getExpectedPlatformBehavior() {
    const platform = os.platform();
    
    return {
      platform,
      isWindows: platform === 'win32',
      isMacOS: platform === 'darwin',
      isLinux: platform === 'linux',
      pathSeparator: platform === 'win32' ? '\\' : '/',
      executableExtension: platform === 'win32' ? '.exe' : '',
      expectedShortcutModifier: platform === 'darwin' ? 'Meta' : 'Control'
    };
  }
}