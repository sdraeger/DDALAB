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
        { 
          name: 'ddalab-web', 
          status: 'running',
          ports: ['3000:3000', '443:443'],
          image: 'ddalab/web:latest',
          created: new Date().toISOString(),
          health: 'healthy'
        },
        { 
          name: 'ddalab-api', 
          status: 'running',
          ports: ['8000:8000'],
          image: 'ddalab/api:latest',
          created: new Date().toISOString(),
          health: 'healthy'
        },
        { 
          name: 'ddalab-db', 
          status: 'running',
          ports: ['5432:5432'],
          image: 'postgres:13',
          created: new Date().toISOString(),
          health: 'healthy'
        }
      ],
      networks: [
        { name: 'ddalab_default', driver: 'bridge' }
      ],
      volumes: [
        { name: 'ddalab_data', mountpoint: '/var/lib/postgresql/data' },
        { name: 'ddalab_logs', mountpoint: '/var/log' }
      ]
    };
    
    await fs.writeFile(dockerStatusPath, JSON.stringify(mockDockerStatus, null, 2));
    
    // Create mock deployment status
    const deploymentStatusPath = path.join(this.testDataPath, 'deployment-status.json');
    const mockDeploymentStatus = {
      isDeployed: true,
      deploymentTime: new Date().toISOString(),
      services: {
        web: { status: 'running', url: 'https://localhost', port: 443 },
        api: { status: 'running', url: 'http://localhost:8000', port: 8000 },
        database: { status: 'running', url: 'postgresql://localhost:5432/ddalab', port: 5432 }
      },
      healthChecks: {
        web: { status: 'healthy', lastCheck: new Date().toISOString() },
        api: { status: 'healthy', lastCheck: new Date().toISOString() },
        database: { status: 'healthy', lastCheck: new Date().toISOString() }
      }
    };
    
    await fs.writeFile(deploymentStatusPath, JSON.stringify(mockDeploymentStatus, null, 2));
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
      MOCK_DEPLOYMENT_STATUS: 'deployed',
      MOCK_SERVICES_HEALTHY: 'true',
      DISABLE_REAL_FILE_OPERATIONS: 'true',
      DISABLE_REAL_NETWORK_CALLS: 'false', // Allow network calls for connectivity testing
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
  
  static async getMockDockerStatus(): Promise<any> {
    try {
      const statusPath = path.join(this.testDataPath, 'docker-status.json');
      const content = await fs.readFile(statusPath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  
  static async getMockDeploymentStatus(): Promise<any> {
    try {
      const statusPath = path.join(this.testDataPath, 'deployment-status.json');
      const content = await fs.readFile(statusPath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  
  static async updateDeploymentStatus(status: Partial<any>): Promise<void> {
    try {
      const statusPath = path.join(this.testDataPath, 'deployment-status.json');
      const currentStatus = await this.getMockDeploymentStatus() || {};
      const updatedStatus = { ...currentStatus, ...status };
      await fs.writeFile(statusPath, JSON.stringify(updatedStatus, null, 2));
    } catch (error) {
      console.warn('Failed to update deployment status:', error);
    }
  }
  
  static getExpectedDDALABUrls(): string[] {
    return [
      'https://localhost',
      'https://localhost:443',
      'http://localhost:3000',
      'http://localhost:8000'
    ];
  }
}