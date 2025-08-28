import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

export class MockEnvironment {
  private static testDataPath: string;
  private static mockConfigPath: string;
  
  static async initialize(): Promise<void> {
    // Create a temporary test directory
    this.testDataPath = path.join(os.tmpdir(), 'ddalab-test-env-' + Date.now());
    this.mockConfigPath = path.join(this.testDataPath, 'config');
    
    await fs.mkdir(this.testDataPath, { recursive: true });
    await fs.mkdir(this.mockConfigPath, { recursive: true });
    
    // Create mock Docker installation
    await this.createMockDockerSetup();
    
    // Create mock project structure
    await this.createMockProjectStructure();
    
    // Create mock configuration files
    await this.createMockConfiguration();
  }
  
  static async cleanup(): Promise<void> {
    if (this.testDataPath) {
      try {
        await fs.rm(this.testDataPath, { recursive: true });
      } catch (error) {
        console.warn('Failed to cleanup test environment:', error);
      }
    }
  }
  
  private static async createMockDockerSetup(): Promise<void> {
    // Create mock Docker status
    const dockerStatusPath = path.join(this.testDataPath, 'docker-status.json');
    const mockDockerStatus = {
      isInstalled: true,
      isRunning: true,
      version: '20.10.0',
      containers: [
        { name: 'ddalab-web', status: 'running' },
        { name: 'ddalab-api', status: 'running' },
        { name: 'ddalab-db', status: 'running' }
      ]
    };
    
    await fs.writeFile(dockerStatusPath, JSON.stringify(mockDockerStatus, null, 2));
  }
  
  private static async createMockProjectStructure(): Promise<void> {
    // Create mock project directories
    const projectPath = path.join(this.testDataPath, 'mock-project');
    const directories = [
      'data',
      'logs',
      'config',
      'certs',
      'uploads'
    ];
    
    for (const dir of directories) {
      await fs.mkdir(path.join(projectPath, dir), { recursive: true });
    }
    
    // Create mock docker-compose.yml
    const dockerCompose = `
version: '3.8'
services:
  web:
    image: ddalab/web:latest
    ports:
      - "3000:3000"
  api:
    image: ddalab/api:latest
    ports:
      - "8000:8000"
  db:
    image: postgres:13
    environment:
      POSTGRES_DB: ddalab
      POSTGRES_USER: ddalab
      POSTGRES_PASSWORD: password
`;
    
    await fs.writeFile(path.join(projectPath, 'docker-compose.yml'), dockerCompose.trim());
  }
  
  private static async createMockConfiguration(): Promise<void> {
    // Create mock .env file
    const envContent = `
# Mock Configuration for Testing
NODE_ENV=test
DATABASE_URL=postgresql://ddalab:password@localhost:5432/ddalab
API_URL=http://localhost:8000
WEB_URL=http://localhost:3000
STORAGE_PATH=${this.testDataPath}/data
LOG_LEVEL=info
ENABLE_SSL=false
SSL_CERT_PATH=${this.testDataPath}/certs/server.crt
SSL_KEY_PATH=${this.testDataPath}/certs/server.key
`;
    
    await fs.writeFile(path.join(this.mockConfigPath, '.env'), envContent.trim());
    
    // Create mock application configuration
    const appConfig = {
      isFirstRun: false,
      hasCompletedSetup: true,
      projectPath: path.join(this.testDataPath, 'mock-project'),
      dockerInstalled: true,
      dockerRunning: true,
      servicesConfigured: true,
      certificatesInstalled: true,
      dataDirectory: path.join(this.testDataPath, 'data'),
      allowedDirectories: [
        path.join(this.testDataPath, 'data'),
        path.join(this.testDataPath, 'uploads')
      ],
      theme: 'light',
      notifications: {
        enabled: true,
        sound: false
      }
    };
    
    await fs.writeFile(
      path.join(this.mockConfigPath, 'app-config.json'), 
      JSON.stringify(appConfig, null, 2)
    );
  }
  
  static getEnvironmentVariables(): Record<string, string> {
    return {
      NODE_ENV: 'test',
      ELECTRON_IS_TESTING: 'true',
      TEST_DATA_PATH: this.testDataPath,
      TEST_CONFIG_PATH: this.mockConfigPath,
      MOCK_DOCKER_STATUS: 'running',
      MOCK_PROJECT_CONFIGURED: 'true',
      DISABLE_REAL_FILE_OPERATIONS: 'true',
      TEST_VIRTUALIZED_ENV: 'true'
    };
  }
  
  static getTestDataPath(): string {
    return this.testDataPath;
  }
  
  static getMockConfigPath(): string {
    return this.mockConfigPath;
  }
  
  static async createMockFile(relativePath: string, content: string): Promise<string> {
    const fullPath = path.join(this.testDataPath, relativePath);
    const dir = path.dirname(fullPath);
    
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content);
    
    return fullPath;
  }
  
  static async fileExists(relativePath: string): Promise<boolean> {
    const fullPath = path.join(this.testDataPath, relativePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }
}