/**
 * Deployment Configuration Service
 * 
 * Manages DDALAB deployment configuration with versioning, persistence,
 * and seamless updates. This service ensures configuration is maintained
 * across updates without breaking changes.
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '../utils/logger';
import yaml from 'js-yaml';
import semver from 'semver';

export interface DeploymentConfig {
  version: string;
  environment: 'development' | 'staging' | 'production';
  
  // Core settings
  api: {
    host: string;
    port: number;
    publicUrl: string;
  };
  
  web: {
    port: number;
    publicUrl: string;
  };
  
  // Database configuration
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };
  
  // Storage configuration
  storage: {
    minio: {
      host: string;
      port: number;
      accessKey: string;
      secretKey: string;
      bucketName: string;
      useSSL: boolean;
    };
    dataDir: string;
    allowedDirs: string[];
  };
  
  // Cache configuration
  cache: {
    redis: {
      host: string;
      port: number;
      password?: string;
      db: number;
    };
  };
  
  // DDA Engine
  dda: {
    binaryPath: string;
    maxConcurrentTasks: number;
    taskTimeout: number;
  };
  
  // Authentication
  auth: {
    mode: 'local' | 'ldap' | 'oauth';
    jwtSecret: string;
    tokenExpiration: number;
  };
  
  // Docker settings
  docker: {
    image: string;
    composeFile: string;
    networks: string[];
    volumes: Record<string, string>;
    environmentOverrides: Record<string, string>;
  };
  
  // SSL/TLS
  ssl: {
    enabled: boolean;
    certPath?: string;
    keyPath?: string;
    letsEncrypt?: {
      email: string;
      domains: string[];
      staging: boolean;
    };
  };
  
  // Update settings
  updates: {
    channel: 'stable' | 'beta' | 'dev';
    checkInterval: number;
    autoUpdate: boolean;
    autoBackup: boolean;
  };
}

export interface ConfigMigration {
  version: string;
  description: string;
  up: (config: any) => any;
  down: (config: any) => any;
}

export class DeploymentConfigService {
  private static instance: DeploymentConfigService;
  private configPath: string;
  private backupPath: string;
  private config: DeploymentConfig | null = null;
  private configHistory: Array<{ timestamp: Date; config: DeploymentConfig }> = [];
  
  // Configuration schema version
  private static readonly CURRENT_VERSION = '2.0.0';
  
  // Default configuration
  private static readonly DEFAULT_CONFIG: DeploymentConfig = {
    version: DeploymentConfigService.CURRENT_VERSION,
    environment: 'production',
    
    api: {
      host: '0.0.0.0',
      port: 8001,
      publicUrl: 'http://localhost:8001'
    },
    
    web: {
      port: 3000,
      publicUrl: 'http://localhost:3000'
    },
    
    database: {
      host: 'ddalab-postgres',  // Use container name for Docker networking
      port: 5432,
      name: 'ddalab',
      user: 'ddalab',
      password: 'CHANGE_ME_IN_PRODUCTION'
    },
    
    storage: {
      minio: {
        host: 'ddalab-minio',  // Use container name for Docker networking
        port: 9000,
        accessKey: 'minioadmin',
        secretKey: 'minioadmin',
        bucketName: 'dda-results',
        useSSL: false
      },
      dataDir: '/app/data',
      allowedDirs: ['/app/data']
    },
    
    cache: {
      redis: {
        host: 'ddalab-redis',  // Use container name for Docker networking
        port: 6379,
        db: 0
      }
    },
    
    dda: {
      binaryPath: '/app/bin/run_DDA_ASCII',
      maxConcurrentTasks: 10,
      taskTimeout: 600
    },
    
    auth: {
      mode: 'local',
      jwtSecret: 'CHANGE_ME_RANDOM_32_CHAR_STRING',
      tokenExpiration: 10080
    },
    
    docker: {
      image: 'ddalab:latest',
      composeFile: 'docker-compose.prod.yml',
      networks: ['ddalab-network'],
      volumes: {
        'ddalab-data': '/app/data',
        'postgres-data': '/var/lib/postgresql/data',
        'redis-data': '/data',
        'minio-data': '/data'
      },
      environmentOverrides: {}
    },
    
    ssl: {
      enabled: false
    },
    
    updates: {
      channel: 'stable',
      checkInterval: 86400000, // 24 hours
      autoUpdate: false,
      autoBackup: true
    }
  };
  
  private constructor() {
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, 'deployment-config.yml');
    this.backupPath = path.join(userDataPath, 'config-backups');
  }
  
  static getInstance(): DeploymentConfigService {
    if (!DeploymentConfigService.instance) {
      DeploymentConfigService.instance = new DeploymentConfigService();
    }
    return DeploymentConfigService.instance;
  }
  
  /**
   * Initialize the configuration service
   */
  async initialize(): Promise<void> {
    logger.info('Initializing deployment configuration service');
    
    // Ensure backup directory exists
    await fs.mkdir(this.backupPath, { recursive: true });
    
    // Load or create configuration
    await this.loadConfig();
  }
  
  /**
   * Load configuration from disk
   */
  private async loadConfig(): Promise<void> {
    try {
      const configExists = await this.configExists();
      
      if (configExists) {
        const configData = await fs.readFile(this.configPath, 'utf-8');
        const loadedConfig = yaml.load(configData) as DeploymentConfig;
        
        // Validate and migrate if needed
        this.config = await this.validateAndMigrate(loadedConfig);
        logger.info(`Configuration loaded (version ${this.config.version})`);
      } else {
        // Create default configuration
        this.config = { ...DeploymentConfigService.DEFAULT_CONFIG };
        await this.saveConfig();
        logger.info('Default configuration created');
      }
    } catch (error) {
      logger.error('Failed to load configuration:', error);
      // Fall back to default configuration
      this.config = { ...DeploymentConfigService.DEFAULT_CONFIG };
    }
  }
  
  /**
   * Validate and migrate configuration to current version
   */
  private async validateAndMigrate(config: any): Promise<DeploymentConfig> {
    const currentVersion = config.version || '1.0.0';
    
    if (semver.lt(currentVersion, DeploymentConfigService.CURRENT_VERSION)) {
      logger.info(`Migrating configuration from ${currentVersion} to ${DeploymentConfigService.CURRENT_VERSION}`);
      
      // Create backup before migration
      await this.createBackup('pre-migration');
      
      // Apply migrations
      let migratedConfig = config;
      for (const migration of this.getMigrations()) {
        if (semver.gt(migration.version, currentVersion) && 
            semver.lte(migration.version, DeploymentConfigService.CURRENT_VERSION)) {
          logger.info(`Applying migration: ${migration.description}`);
          migratedConfig = migration.up(migratedConfig);
        }
      }
      
      migratedConfig.version = DeploymentConfigService.CURRENT_VERSION;
      return migratedConfig;
    }
    
    return config;
  }
  
  /**
   * Get all configuration migrations
   */
  private getMigrations(): ConfigMigration[] {
    return [
      {
        version: '2.0.0',
        description: 'Add Docker deployment configuration',
        up: (config: any) => ({
          ...config,
          docker: config.docker || DeploymentConfigService.DEFAULT_CONFIG.docker,
          ssl: config.ssl || DeploymentConfigService.DEFAULT_CONFIG.ssl,
          updates: config.updates || DeploymentConfigService.DEFAULT_CONFIG.updates
        }),
        down: (config: any) => {
          const { docker, ssl, updates, ...rest } = config;
          return rest;
        }
      }
    ];
  }
  
  /**
   * Save configuration to disk
   */
  async saveConfig(): Promise<void> {
    if (!this.config) return;
    
    try {
      // Add to history
      this.configHistory.push({
        timestamp: new Date(),
        config: { ...this.config }
      });
      
      // Keep only last 10 history entries
      if (this.configHistory.length > 10) {
        this.configHistory = this.configHistory.slice(-10);
      }
      
      // Save to file
      const yamlStr = yaml.dump(this.config, { 
        indent: 2,
        lineWidth: -1,
        noRefs: true
      });
      await fs.writeFile(this.configPath, yamlStr, 'utf-8');
      
      logger.info('Configuration saved');
    } catch (error) {
      logger.error('Failed to save configuration:', error);
      throw error;
    }
  }
  
  /**
   * Create a backup of current configuration
   */
  async createBackup(reason: string = 'manual'): Promise<string> {
    if (!this.config) return '';
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(this.backupPath, `config-${reason}-${timestamp}.yml`);
    
    try {
      const yamlStr = yaml.dump(this.config);
      await fs.writeFile(backupFile, yamlStr, 'utf-8');
      logger.info(`Configuration backup created: ${backupFile}`);
      return backupFile;
    } catch (error) {
      logger.error('Failed to create backup:', error);
      throw error;
    }
  }
  
  /**
   * Restore configuration from backup
   */
  async restoreFromBackup(backupFile: string): Promise<void> {
    try {
      const backupData = await fs.readFile(backupFile, 'utf-8');
      const backupConfig = yaml.load(backupData) as DeploymentConfig;
      
      // Create backup of current config before restoring
      await this.createBackup('pre-restore');
      
      this.config = await this.validateAndMigrate(backupConfig);
      await this.saveConfig();
      
      logger.info(`Configuration restored from: ${backupFile}`);
    } catch (error) {
      logger.error('Failed to restore from backup:', error);
      throw error;
    }
  }
  
  /**
   * Get current configuration
   */
  getConfig(): DeploymentConfig {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }
    return { ...this.config };
  }
  
  /**
   * Update configuration
   */
  async updateConfig(updates: Partial<DeploymentConfig>): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }
    
    // Create backup before update
    if (this.config.updates?.autoBackup) {
      await this.createBackup('pre-update');
    }
    
    // Deep merge updates
    this.config = this.deepMerge(this.config, updates);
    await this.saveConfig();
  }
  
  /**
   * Generate environment variables for Docker
   */
  generateDockerEnv(): Record<string, string> {
    if (!this.config) return {};
    
    const env: Record<string, string> = {
      // Use DDALAB_ prefix for compatibility with start.sh script
      // Deployment settings
      DDALAB_ENVIRONMENT: this.config.environment,
      DDALAB_DEBUG: this.config.environment === 'development' ? 'true' : 'false',
      
      // API settings
      DDALAB_API_HOST: this.config.api.host,
      DDALAB_API_PORT: this.config.api.port.toString(),
      DDALAB_PUBLIC_API_URL: this.config.api.publicUrl,
      
      // Web settings
      DDALAB_WEB_PORT: this.config.web.port.toString(),
      DDALAB_PUBLIC_APP_URL: this.config.web.publicUrl,
      
      // Database settings - CRITICAL: Use DDALAB_ prefix
      DDALAB_DB_HOST: this.config.database.host,
      DDALAB_DB_PORT: this.config.database.port.toString(),
      DDALAB_DB_NAME: this.config.database.name,
      DDALAB_DB_USER: this.config.database.user,
      DDALAB_DB_PASSWORD: this.config.database.password,
      
      // Storage settings
      DDALAB_MINIO_HOST: `${this.config.storage.minio.host}:${this.config.storage.minio.port}`,
      DDALAB_MINIO_ACCESS_KEY: this.config.storage.minio.accessKey,
      DDALAB_MINIO_SECRET_KEY: this.config.storage.minio.secretKey,
      DDALAB_MINIO_BUCKET_NAME: this.config.storage.minio.bucketName,
      DDALAB_DATA_DIR: this.config.storage.dataDir,
      DDALAB_ALLOWED_DIRS: this.config.storage.allowedDirs.join(','),
      
      // Cache settings
      DDALAB_REDIS_HOST: this.config.cache.redis.host,
      DDALAB_REDIS_PORT: this.config.cache.redis.port.toString(),
      DDALAB_REDIS_PASSWORD: this.config.cache.redis.password || '',
      DDALAB_REDIS_DB: this.config.cache.redis.db.toString(),
      
      // DDA settings
      DDALAB_DDA_BINARY_PATH: this.config.dda.binaryPath,
      DDALAB_MAX_CONCURRENT_TASKS: this.config.dda.maxConcurrentTasks.toString(),
      DDALAB_TASK_TIMEOUT: this.config.dda.taskTimeout.toString(),
      
      // Auth settings
      DDALAB_AUTH_MODE: this.config.auth.mode,
      DDALAB_JWT_SECRET_KEY: this.config.auth.jwtSecret,
      DDALAB_TOKEN_EXPIRATION_MINUTES: this.config.auth.tokenExpiration.toString(),
      
      // Docker settings
      DDALAB_IMAGE: this.config.docker.image,
      
      // Also include legacy environment variables that Python expects directly
      DB_HOST: this.config.database.host,
      DB_PORT: this.config.database.port.toString(),
      DB_NAME: this.config.database.name,
      DB_USER: this.config.database.user,
      DB_PASSWORD: this.config.database.password,
      
      JWT_SECRET_KEY: this.config.auth.jwtSecret,
      
      MINIO_HOST: `${this.config.storage.minio.host}:${this.config.storage.minio.port}`,
      MINIO_ACCESS_KEY: this.config.storage.minio.accessKey,
      MINIO_SECRET_KEY: this.config.storage.minio.secretKey,
      
      REDIS_HOST: this.config.cache.redis.host,
      REDIS_PORT: this.config.cache.redis.port.toString(),
      
      DATA_DIR: this.config.storage.dataDir,
      ALLOWED_DIRS: this.config.storage.allowedDirs.join(','),
      DDA_BINARY_PATH: this.config.dda.binaryPath,
      
      // Apply any custom overrides
      ...this.config.docker.environmentOverrides
    };
    
    return env;
  }
  
  /**
   * Export configuration for docker-compose
   */
  async exportDockerCompose(): Promise<string> {
    if (!this.config) throw new Error('Configuration not initialized');
    
    const composeConfig = {
      version: '3.8',
      services: {
        ddalab: {
          image: this.config.docker.image,
          restart: 'unless-stopped',
          ports: [
            `${this.config.api.port}:8001`,
            `${this.config.web.port}:3000`
          ],
          environment: this.generateDockerEnv(),
          volumes: Object.entries(this.config.docker.volumes).map(
            ([host, container]) => `${host}:${container}`
          ),
          networks: this.config.docker.networks,
          depends_on: {
            postgres: { condition: 'service_healthy' },
            redis: { condition: 'service_healthy' },
            minio: { condition: 'service_healthy' }
          }
        },
        // Additional services would be added here
      },
      volumes: Object.keys(this.config.docker.volumes).reduce((acc, vol) => {
        acc[vol] = {};
        return acc;
      }, {} as Record<string, {}>),
      networks: this.config.docker.networks.reduce((acc, net) => {
        acc[net] = { driver: 'bridge' };
        return acc;
      }, {} as Record<string, any>)
    };
    
    return yaml.dump(composeConfig);
  }
  
  /**
   * Check if configuration exists
   */
  private async configExists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Deep merge helper
   */
  private deepMerge(target: any, source: any): any {
    const output = { ...target };
    
    for (const key in source) {
      if (source[key] instanceof Object && key in target) {
        output[key] = this.deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
    
    return output;
  }
  
  /**
   * Get configuration history
   */
  getHistory(): Array<{ timestamp: Date; config: DeploymentConfig }> {
    return [...this.configHistory];
  }
  
  /**
   * List available backups
   */
  async listBackups(): Promise<Array<{ file: string; timestamp: Date; reason: string }>> {
    try {
      const files = await fs.readdir(this.backupPath);
      const backups = [];
      
      for (const file of files) {
        if (file.endsWith('.yml')) {
          const match = file.match(/config-(.+)-(\d{4}-\d{2}-\d{2}T.+)\.yml/);
          if (match) {
            const [, reason, timestamp] = match;
            backups.push({
              file: path.join(this.backupPath, file),
              timestamp: new Date(timestamp.replace(/-/g, ':')),
              reason
            });
          }
        }
      }
      
      return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      logger.error('Failed to list backups:', error);
      return [];
    }
  }
}