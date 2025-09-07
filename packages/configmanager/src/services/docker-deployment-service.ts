/**
 * Docker Deployment Service
 * 
 * Enhanced Docker integration for DDALAB deployment through ConfigManager.
 * Manages Docker operations with configuration from deployment-config-service.
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '../utils/logger';
import { DeploymentConfigService, DeploymentConfig } from './deployment-config-service';
import yaml from 'js-yaml';

export interface ServiceHealth {
  service: string;
  status: 'healthy' | 'unhealthy' | 'starting' | 'stopped';
  message?: string;
  lastCheck: Date;
}

export interface DeploymentStatus {
  status: 'stopped' | 'starting' | 'running' | 'error' | 'updating';
  services: Record<string, ServiceHealth>;
  error?: string;
}

export interface DockerComposeConfig {
  version: string;
  services: Record<string, any>;
  networks?: Record<string, any>;
  volumes?: Record<string, any>;
}

export class DockerDeploymentService extends EventEmitter {
  private static instance: DockerDeploymentService;
  private configService: DeploymentConfigService;
  private dockerProcess: ChildProcess | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private deploymentStatus: DeploymentStatus = {
    status: 'stopped',
    services: {}
  };
  
  private readonly requiredServices = ['ddalab', 'postgres', 'redis', 'minio', 'traefik'];
  
  private constructor() {
    super();
    this.configService = DeploymentConfigService.getInstance();
  }
  
  static getInstance(): DockerDeploymentService {
    if (!DockerDeploymentService.instance) {
      DockerDeploymentService.instance = new DockerDeploymentService();
    }
    return DockerDeploymentService.instance;
  }
  
  /**
   * Initialize the Docker deployment service
   */
  async initialize(): Promise<void> {
    logger.info('Initializing Docker deployment service');
    
    // Check initial status
    await this.checkDeploymentStatus();
    
    // Start health monitoring if services are running
    if (this.deploymentStatus.status === 'running') {
      this.startHealthMonitoring();
    }
  }
  
  /**
   * Generate docker-compose.yml from configuration
   */
  async generateDockerCompose(): Promise<string> {
    const config = this.configService.getConfig();
    const composeConfig = await this.buildDockerComposeConfig(config);
    
    // Save to file
    const composePath = path.join(
      await this.getDeploymentPath(),
      config.docker.composeFile
    );
    
    const yamlContent = yaml.dump(composeConfig, {
      indent: 2,
      lineWidth: -1,
      noRefs: true
    });
    
    await fs.mkdir(path.dirname(composePath), { recursive: true });
    await fs.writeFile(composePath, yamlContent, 'utf-8');
    
    logger.info(`Docker Compose file generated: ${composePath}`);
    return composePath;
  }
  
  /**
   * Build Docker Compose configuration
   */
  private async buildDockerComposeConfig(config: DeploymentConfig): Promise<DockerComposeConfig> {
    const env = this.configService.generateDockerEnv();
    
    return {
      version: '3.8',
      
      services: {
        ddalab: {
          image: config.docker.image,
          container_name: 'ddalab',
          restart: 'unless-stopped',
          environment: env,
          volumes: [
            'ddalab-data:/app/data'
          ],
          depends_on: {
            postgres: { condition: 'service_healthy' },
            redis: { condition: 'service_healthy' },
            minio: { condition: 'service_healthy' }
          },
          networks: config.docker.networks,
          healthcheck: {
            test: ['CMD', 'curl', '-f', 'http://localhost:8001/health'],
            interval: '30s',
            timeout: '10s',
            retries: 3,
            start_period: '40s'
          },
          labels: {
            'traefik.enable': 'true',
            // Web interface
            'traefik.http.routers.ddalab-web.rule': 'Host(`localhost`)',
            'traefik.http.routers.ddalab-web.entrypoints': 'websecure',
            'traefik.http.routers.ddalab-web.tls': 'true',
            'traefik.http.services.ddalab-web.loadbalancer.server.port': '3000',
            // API
            'traefik.http.routers.ddalab-api.rule': 'Host(`localhost`) && PathPrefix(`/api`)',
            'traefik.http.routers.ddalab-api.entrypoints': 'websecure',
            'traefik.http.routers.ddalab-api.tls': 'true',
            'traefik.http.services.ddalab-api.loadbalancer.server.port': '8001'
          }
        },
        
        postgres: {
          image: 'postgres:15-alpine',
          container_name: 'ddalab-postgres',
          restart: 'unless-stopped',
          environment: {
            // Use postgres superuser for initialization
            POSTGRES_USER: 'postgres',
            POSTGRES_PASSWORD: config.database.password,
            POSTGRES_DB: 'postgres',
            // Pass app credentials
            APP_DB_USER: config.database.user,
            APP_DB_PASSWORD: config.database.password,
            APP_DB_NAME: config.database.name
          },
          volumes: [
            'postgres-data:/var/lib/postgresql/data',
            `${await this.getDeploymentPath()}/init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro`
          ],
          networks: config.docker.networks,
          healthcheck: {
            test: ['CMD-SHELL', 'pg_isready -U postgres'],
            interval: '10s',
            timeout: '5s',
            retries: 5
          }
        },
        
        redis: {
          image: 'redis:7-alpine',
          container_name: 'ddalab-redis',
          restart: 'unless-stopped',
          command: 'redis-server --appendonly yes',
          volumes: [
            'redis-data:/data'
          ],
          networks: config.docker.networks,
          healthcheck: {
            test: ['CMD', 'redis-cli', 'ping'],
            interval: '10s',
            timeout: '5s',
            retries: 5
          }
        },
        
        minio: {
          image: 'minio/minio:latest',
          container_name: 'ddalab-minio',
          restart: 'unless-stopped',
          command: 'server /data --console-address ":9001"',
          environment: {
            MINIO_ROOT_USER: config.storage.minio.accessKey,
            MINIO_ROOT_PASSWORD: config.storage.minio.secretKey
          },
          volumes: [
            'minio-data:/data'
          ],
          ports: [
            '9000:9000',
            '9001:9001'
          ],
          networks: config.docker.networks,
          healthcheck: {
            test: ['CMD', 'curl', '-f', 'http://localhost:9000/minio/health/live'],
            interval: '30s',
            timeout: '20s',
            retries: 3
          }
        },
        
        traefik: {
          image: 'traefik:v2.10',
          container_name: 'ddalab-traefik',
          restart: 'unless-stopped',
          command: [
            '--providers.docker=true',
            '--providers.docker.exposedbydefault=false',
            '--entrypoints.web.address=:80',
            '--entrypoints.websecure.address=:443',
            '--entrypoints.web.http.redirections.entryPoint.to=websecure',
            '--entrypoints.web.http.redirections.entryPoint.scheme=https',
            '--api.dashboard=false',
            // Default self-signed certificate
            '--providers.file.filename=/etc/traefik/dynamic.yml'
          ],
          ports: [
            '80:80',
            '443:443'
          ],
          volumes: [
            '/var/run/docker.sock:/var/run/docker.sock:ro',
            `${await this.getDeploymentPath()}/certs:/etc/traefik/certs:ro`,
            `${await this.getDeploymentPath()}/traefik-dynamic.yml:/etc/traefik/dynamic.yml:ro`
          ],
          networks: config.docker.networks,
          labels: {
            'traefik.enable': 'true'
          }
        }
      },
      
      networks: config.docker.networks.reduce((acc, net) => {
        acc[net] = { driver: 'bridge' };
        return acc;
      }, {} as Record<string, any>),
      
      volumes: {
        'postgres-data': {},
        'redis-data': {},
        'minio-data': {},
        'ddalab-data': {},
        'traefik-certs': {}
      }
    };
  }
  
  /**
   * Deploy services
   */
  async deploy(): Promise<void> {
    logger.info('Starting DDALAB deployment');
    
    this.deploymentStatus.status = 'starting';
    this.emit('deployment-status-changed', this.deploymentStatus);
    
    try {
      // Generate docker-compose file
      const composePath = await this.generateDockerCompose();
      
      // Generate .env file
      await this.generateEnvFile();
      
      // Generate PostgreSQL init script
      await this.generatePostgresInitScript();
      
      // Generate Traefik configuration and certificates
      await this.generateTraefikConfig();
      await this.generateSelfSignedCertificates();
      
      // Pull latest images
      await this.pullImages(composePath);
      
      // Start services
      await this.startServices(composePath);
      
      // Wait for services to be healthy
      await this.waitForHealthy();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      this.deploymentStatus.status = 'running';
      this.emit('deployment-status-changed', this.deploymentStatus);
      logger.info('DDALAB deployment completed successfully');
      
    } catch (error) {
      logger.error('Deployment failed:', error);
      this.deploymentStatus = {
        status: 'error',
        services: {},
        error: error.message
      };
      this.emit('deployment-status-changed', this.deploymentStatus);
      throw error;
    }
  }
  
  /**
   * Stop deployment
   */
  async stop(): Promise<void> {
    logger.info('Stopping DDALAB deployment');
    
    this.stopHealthMonitoring();
    
    const config = this.configService.getConfig();
    const composePath = path.join(
      await this.getDeploymentPath(),
      config.docker.composeFile
    );
    
    return new Promise((resolve, reject) => {
      const proc = spawn('docker-compose', ['-f', composePath, 'down'], {
        env: this.getDockerEnv()
      });
      
      proc.on('exit', (code) => {
        if (code === 0) {
          this.deploymentStatus = {
            status: 'stopped',
            services: {}
          };
          this.emit('deployment-status-changed', this.deploymentStatus);
          resolve();
        } else {
          reject(new Error(`Docker compose down failed with code ${code}`));
        }
      });
    });
  }
  
  /**
   * Restart services
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.deploy();
  }
  
  /**
   * Update deployment configuration
   */
  async updateConfiguration(updates: Partial<DeploymentConfig>): Promise<void> {
    // Stop services if running
    if (this.deploymentStatus.status === 'running') {
      await this.stop();
    }
    
    // Update configuration
    await this.configService.updateConfig(updates);
    
    // Redeploy with new configuration
    await this.deploy();
  }
  
  /**
   * Get deployment logs
   */
  async getLogs(service?: string, lines: number = 100): Promise<string> {
    const config = this.configService.getConfig();
    const composePath = path.join(
      await this.getDeploymentPath(),
      config.docker.composeFile
    );
    
    const args = ['-f', composePath, 'logs', '--tail', lines.toString()];
    if (service) {
      args.push(service);
    }
    
    return new Promise((resolve, reject) => {
      let output = '';
      const proc = spawn('docker-compose', args, {
        env: this.getDockerEnv()
      });
      
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Failed to get logs: ${output}`));
        }
      });
    });
  }
  
  /**
   * Execute command in service container
   */
  async exec(service: string, command: string[]): Promise<string> {
    const containerName = `ddalab-${service}`;
    
    return new Promise((resolve, reject) => {
      let output = '';
      const proc = spawn('docker', ['exec', containerName, ...command], {
        env: this.getDockerEnv()
      });
      
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Command failed: ${output}`));
        }
      });
    });
  }
  
  /**
   * Pull Docker images
   */
  private async pullImages(composePath: string): Promise<void> {
    logger.info('Pulling Docker images');
    
    return new Promise((resolve, reject) => {
      const proc = spawn('docker-compose', ['-f', composePath, 'pull'], {
        env: this.getDockerEnv()
      });
      
      proc.stdout.on('data', (data) => {
        logger.info(`Docker pull: ${data.toString().trim()}`);
      });
      
      proc.stderr.on('data', (data) => {
        logger.warn(`Docker pull stderr: ${data.toString().trim()}`);
      });
      
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Docker pull failed with code ${code}`));
        }
      });
    });
  }
  
  /**
   * Start Docker services
   */
  private async startServices(composePath: string): Promise<void> {
    logger.info('Starting Docker services');
    
    return new Promise((resolve, reject) => {
      this.dockerProcess = spawn('docker-compose', [
        '-f', composePath,
        'up', '-d'
      ], {
        env: this.getDockerEnv()
      });
      
      this.dockerProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        logger.info(`Docker: ${output.trim()}`);
        this.emit('deployment-output', output);
      });
      
      this.dockerProcess.stderr?.on('data', (data) => {
        const output = data.toString();
        logger.warn(`Docker stderr: ${output.trim()}`);
        this.emit('deployment-output', output);
      });
      
      this.dockerProcess.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Docker compose failed with code ${code}`));
        }
      });
    });
  }
  
  /**
   * Wait for all services to be healthy
   */
  private async waitForHealthy(timeout: number = 300000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const allHealthy = await this.checkAllServicesHealth();
      
      if (allHealthy) {
        logger.info('All services are healthy');
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
    }
    
    throw new Error('Services failed to become healthy within timeout');
  }
  
  /**
   * Check all services health
   */
  private async checkAllServicesHealth(): Promise<boolean> {
    const healthChecks = await Promise.all(
      this.requiredServices.map(service => this.checkServiceHealth(service))
    );
    
    // Update deployment status
    this.requiredServices.forEach((service, index) => {
      this.deploymentStatus.services[service] = healthChecks[index];
    });
    
    this.emit('health-status-changed', this.deploymentStatus.services);
    
    return healthChecks.every(health => health.status === 'healthy');
  }
  
  /**
   * Check individual service health
   */
  private async checkServiceHealth(service: string): Promise<ServiceHealth> {
    try {
      const containerName = service === 'ddalab' ? 'ddalab' : `ddalab-${service}`;
      const output = await this.execCommand(
        `docker inspect ${containerName} --format='{{.State.Health.Status}}'`
      );
      
      const status = output.trim();
      return {
        service,
        status: status === 'healthy' ? 'healthy' : 
                status === 'starting' ? 'starting' : 
                status === 'unhealthy' ? 'unhealthy' : 'stopped',
        lastCheck: new Date()
      };
    } catch (error) {
      return {
        service,
        status: 'stopped',
        message: error.message,
        lastCheck: new Date()
      };
    }
  }
  
  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.stopHealthMonitoring();
    
    // Check health every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      await this.checkAllServicesHealth();
    }, 30000);
  }
  
  /**
   * Stop health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
  
  /**
   * Check deployment status
   */
  async checkDeploymentStatus(): Promise<DeploymentStatus> {
    try {
      const running = await this.areServicesRunning();
      if (running) {
        await this.checkAllServicesHealth();
        this.deploymentStatus.status = 'running';
      } else {
        this.deploymentStatus = {
          status: 'stopped',
          services: {}
        };
      }
    } catch (error) {
      this.deploymentStatus = {
        status: 'error',
        services: {},
        error: error.message
      };
    }
    
    return this.deploymentStatus;
  }
  
  /**
   * Check if services are running
   */
  private async areServicesRunning(): Promise<boolean> {
    try {
      const output = await this.execCommand('docker ps --format "{{.Names}}"');
      const runningContainers = output.trim().split('\n');
      return this.requiredServices.every(service => {
        const containerName = service === 'ddalab' ? 'ddalab' : `ddalab-${service}`;
        return runningContainers.includes(containerName);
      });
    } catch {
      return false;
    }
  }
  
  /**
   * Get deployment path
   */
  private async getDeploymentPath(): Promise<string> {
    const deployPath = path.join(process.env.HOME || '', '.ddalab', 'deployment');
    await fs.mkdir(deployPath, { recursive: true });
    return deployPath;
  }
  
  /**
   * Generate .env file from configuration
   */
  private async generateEnvFile(): Promise<void> {
    const deployPath = await this.getDeploymentPath();
    const envPath = path.join(deployPath, '.env');
    
    const env = this.configService.generateDockerEnv();
    const envContent = Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    
    await fs.writeFile(envPath, envContent, 'utf-8');
    logger.info('Environment file generated');
  }
  
  /**
   * Generate PostgreSQL initialization script
   */
  private async generatePostgresInitScript(): Promise<void> {
    const deployPath = await this.getDeploymentPath();
    const initPath = path.join(deployPath, 'init-db.sql');
    const config = this.configService.getConfig();
    
    const initScript = `-- PostgreSQL initialization script
-- Generated by DDALAB ConfigManager

-- Create role if it doesn't exist
DO
$do$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE  rolname = '${config.database.user}') THEN
      
      CREATE ROLE ${config.database.user} WITH LOGIN PASSWORD '${config.database.password}';
   END IF;
END
$do$;

-- Grant necessary permissions
ALTER ROLE ${config.database.user} CREATEDB;

-- Create database if it doesn't exist
SELECT 'CREATE DATABASE ${config.database.name} OWNER ${config.database.user}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${config.database.name}')\\gexec

-- Grant all privileges on database
GRANT ALL PRIVILEGES ON DATABASE ${config.database.name} TO ${config.database.user};
`;
    
    await fs.writeFile(initPath, initScript, 'utf-8');
    logger.info('PostgreSQL init script generated');
  }
  
  /**
   * Generate Traefik dynamic configuration
   */
  private async generateTraefikConfig(): Promise<void> {
    const deployPath = await this.getDeploymentPath();
    const configPath = path.join(deployPath, 'traefik-dynamic.yml');
    
    const traefikConfig = {
      tls: {
        stores: {
          default: {
            defaultCertificate: {
              certFile: '/etc/traefik/certs/cert.pem',
              keyFile: '/etc/traefik/certs/key.pem'
            }
          }
        }
      }
    };
    
    const yamlContent = yaml.dump(traefikConfig, {
      indent: 2,
      lineWidth: -1,
      noRefs: true
    });
    
    await fs.writeFile(configPath, yamlContent, 'utf-8');
    logger.info('Traefik configuration generated');
  }
  
  /**
   * Generate self-signed certificates for HTTPS
   */
  private async generateSelfSignedCertificates(): Promise<void> {
    const deployPath = await this.getDeploymentPath();
    const certsDir = path.join(deployPath, 'certs');
    await fs.mkdir(certsDir, { recursive: true });
    
    const certPath = path.join(certsDir, 'cert.pem');
    const keyPath = path.join(certsDir, 'key.pem');
    
    // Check if certificates already exist
    try {
      await fs.access(certPath);
      await fs.access(keyPath);
      logger.info('SSL certificates already exist');
      return;
    } catch {
      // Generate new certificates
    }
    
    try {
      // Generate self-signed certificate using openssl
      await this.execCommand(
        `openssl req -x509 -nodes -days 365 -newkey rsa:2048 ` +
        `-keyout "${keyPath}" -out "${certPath}" ` +
        `-subj "/C=US/ST=State/L=City/O=DDALAB/CN=localhost"`
      );
      
      logger.info('Self-signed SSL certificates generated');
    } catch (error) {
      logger.warn('Failed to generate SSL certificates:', error);
      // Continue without SSL - Traefik will handle it
    }
  }
  
  /**
   * Get Docker environment
   */
  private getDockerEnv(): Record<string, string> {
    return {
      ...process.env,
      PATH: [
        '/usr/local/bin',
        '/opt/homebrew/bin',
        '/usr/bin',
        '/bin',
        process.env.PATH
      ].join(':')
    };
  }
  
  /**
   * Execute shell command
   */
  private async execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('sh', ['-c', command], {
        env: this.getDockerEnv()
      });
      
      let output = '';
      let errorOutput = '';
      
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(errorOutput || `Command failed with code ${code}`));
        }
      });
    });
  }
  
  /**
   * Get current deployment status
   */
  getDeploymentStatus(): DeploymentStatus {
    return { ...this.deploymentStatus };
  }
}