#!/usr/bin/env node

/**
 * DDALAB Configuration Validator
 * 
 * Validates and normalizes environment configuration across all deployment modes:
 * - Local development
 * - Docker Compose
 * - CI/CD
 * - ConfigManager orchestration
 */

const fs = require('fs');
const path = require('path');

// Define the complete configuration schema
const CONFIG_SCHEMA = {
  // Core deployment settings
  DDALAB_ENVIRONMENT: {
    required: true,
    default: 'production',
    values: ['development', 'production', 'testing'],
    description: 'Deployment environment type'
  },
  DDALAB_DEBUG: {
    required: false,
    default: 'false',
    type: 'boolean',
    description: 'Enable debug logging'
  },
  
  // API Configuration
  DDALAB_API_HOST: {
    required: true,
    default: '0.0.0.0',
    description: 'API server bind address'
  },
  DDALAB_API_PORT: {
    required: true,
    default: '8001',
    type: 'number',
    description: 'API server port'
  },
  
  // Database
  DDALAB_DB_HOST: {
    required: true,
    default: 'postgres',
    description: 'PostgreSQL host'
  },
  DDALAB_DB_PORT: {
    required: true,
    default: '5432',
    type: 'number',
    description: 'PostgreSQL port'
  },
  DDALAB_DB_NAME: {
    required: true,
    default: 'ddalab',
    description: 'Database name'
  },
  DDALAB_DB_USER: {
    required: true,
    sensitive: true,
    description: 'Database username'
  },
  DDALAB_DB_PASSWORD: {
    required: true,
    sensitive: true,
    description: 'Database password'
  },
  
  // Authentication
  DDALAB_AUTH_MODE: {
    required: true,
    default: 'local',
    values: ['local', 'multi-user'],
    description: 'Authentication mode'
  },
  DDALAB_JWT_SECRET_KEY: {
    required: true,
    sensitive: true,
    minLength: 32,
    description: 'JWT signing secret'
  },
  
  // Storage
  DDALAB_MINIO_HOST: {
    required: true,
    default: 'minio:9000',
    description: 'MinIO server host:port'
  },
  DDALAB_MINIO_ACCESS_KEY: {
    required: true,
    sensitive: true,
    description: 'MinIO access key'
  },
  DDALAB_MINIO_SECRET_KEY: {
    required: true,
    sensitive: true,
    description: 'MinIO secret key'
  },
  DDALAB_DATA_DIR: {
    required: true,
    default: '/app/data',
    type: 'path',
    description: 'Data directory path'
  },
  DDALAB_ALLOWED_DIRS: {
    required: true,
    type: 'path-list',
    description: 'Comma-separated list of allowed directories'
  },
  
  // DDA Engine
  DDALAB_DDA_BINARY_PATH: {
    required: true,
    default: '/app/bin/run_DDA_ASCII',
    type: 'path',
    description: 'DDA binary executable path'
  },
  
  // Redis
  DDALAB_REDIS_HOST: {
    required: true,
    default: 'redis',
    description: 'Redis host'
  },
  DDALAB_REDIS_PORT: {
    required: true,
    default: '6379',
    type: 'number',
    description: 'Redis port'
  }
};

class ConfigValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.config = {};
  }

  /**
   * Load configuration from multiple sources in priority order:
   * 1. Environment variables
   * 2. .env.local (development overrides)
   * 3. .env (production defaults)
   */
  loadConfig() {
    // Load .env files in priority order
    this.loadEnvFile('.env.master');  // Master configuration first
    this.loadEnvFile('.env');        // Generated/override config
    this.loadEnvFile('.env.local');  // Local development overrides
    
    // Environment variables override everything
    Object.keys(CONFIG_SCHEMA).forEach(key => {
      if (process.env[key]) {
        this.config[key] = process.env[key];
      }
    });
  }

  loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    
    const content = fs.readFileSync(filePath, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([^#\s][^=]*?)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        if (CONFIG_SCHEMA[key] && !this.config[key]) {
          this.config[key] = value.replace(/^["']|["']$/g, ''); // Remove quotes
        }
      }
    });
  }

  /**
   * Validate configuration against schema
   */
  validate() {
    Object.entries(CONFIG_SCHEMA).forEach(([key, schema]) => {
      const value = this.config[key];
      
      // Check required fields
      if (schema.required && (!value || value === '')) {
        if (schema.default) {
          this.config[key] = schema.default;
          this.warnings.push(`Using default value for ${key}: ${schema.default}`);
        } else {
          this.errors.push(`Required configuration missing: ${key} (${schema.description})`);
        }
        return;
      }

      if (!value) return; // Skip validation for optional empty values

      // Type validation
      if (schema.type === 'boolean') {
        if (!['true', 'false', '1', '0'].includes(value.toLowerCase())) {
          this.errors.push(`${key} must be a boolean value (true/false)`);
        }
      }

      if (schema.type === 'number') {
        if (isNaN(parseInt(value))) {
          this.errors.push(`${key} must be a number`);
        }
      }

      // Value validation
      if (schema.values && !schema.values.includes(value)) {
        this.errors.push(`${key} must be one of: ${schema.values.join(', ')}`);
      }

      // Length validation
      if (schema.minLength && value.length < schema.minLength) {
        this.errors.push(`${key} must be at least ${schema.minLength} characters long`);
      }

      // Path validation
      if (schema.type === 'path' && !path.isAbsolute(value) && !value.startsWith('./') && !value.startsWith('../')) {
        this.warnings.push(`${key} should be an absolute path or relative path starting with ./ or ../`);
      }
    });
  }

  /**
   * Generate deployment-specific configuration files
   */
  generateConfigs() {
    const env = this.config.DDALAB_ENVIRONMENT || 'production';
    
    // Generate Docker Compose environment
    this.generateDockerComposeEnv();
    
    // Generate API server configuration
    this.generateApiConfig();
    
    // Generate frontend configuration
    this.generateFrontendConfig();
    
    // Generate ConfigManager template
    this.generateConfigManagerTemplate();
  }

  generateDockerComposeEnv() {
    const dockerEnv = {
      // Docker Compose specific variables
      POSTGRES_USER: this.config.DDALAB_DB_USER,
      POSTGRES_PASSWORD: this.config.DDALAB_DB_PASSWORD,
      POSTGRES_DB: this.config.DDALAB_DB_NAME,
      
      MINIO_ROOT_USER: this.config.DDALAB_MINIO_ACCESS_KEY,
      MINIO_ROOT_PASSWORD: this.config.DDALAB_MINIO_SECRET_KEY,
      
      // Pass through all DDALAB variables
      ...this.config
    };

    const content = Object.entries(dockerEnv)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
      
    fs.writeFileSync('.env.docker', content);
  }

  generateApiConfig() {
    // Create API-specific config
    const apiConfig = Object.entries(this.config)
      .filter(([key]) => key.startsWith('DDALAB_'))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
      
    fs.writeFileSync('packages/api/.env.generated', apiConfig);
  }

  generateFrontendConfig() {
    const frontendConfig = {
      NEXT_PUBLIC_API_URL: this.config.NEXT_PUBLIC_API_URL || `http://localhost:${this.config.DDALAB_API_PORT}`,
      NEXTAUTH_URL: this.config.NEXTAUTH_URL || 'http://localhost:3000',
      NEXTAUTH_SECRET: this.config.DDALAB_JWT_SECRET_KEY,
      NODE_ENV: this.config.DDALAB_ENVIRONMENT === 'development' ? 'development' : 'production'
    };

    const content = Object.entries(frontendConfig)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
      
    ['packages/web', 'packages/web20'].forEach(pkg => {
      if (fs.existsSync(pkg)) {
        fs.writeFileSync(`${pkg}/.env.generated`, content);
      }
    });
  }

  generateConfigManagerTemplate() {
    // Create a validated configuration template for ConfigManager
    const template = {
      version: '1.0',
      deployment: 'docker-compose',
      validated: new Date().toISOString(),
      configuration: this.config
    };

    fs.writeFileSync('packages/configmanager/resources/ddalab-config.validated.json', 
      JSON.stringify(template, null, 2));
  }

  /**
   * Get configuration with sensitive values masked
   */
  getMaskedConfig() {
    const masked = { ...this.config };
    
    // Mask sensitive values for security
    Object.keys(CONFIG_SCHEMA).forEach(key => {
      if (CONFIG_SCHEMA[key].sensitive && masked[key]) {
        const value = masked[key];
        if (value.length <= 8) {
          masked[key] = '*'.repeat(value.length);
        } else {
          masked[key] = value.substring(0, 3) + '*'.repeat(value.length - 6) + value.substring(value.length - 3);
        }
      }
    });
    
    return masked;
  }

  /**
   * Generate deployment report
   */
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      environment: this.config.DDALAB_ENVIRONMENT,
      validation: {
        errors: this.errors.length,
        warnings: this.warnings.length,
        status: this.errors.length === 0 ? 'VALID' : 'INVALID'
      },
      configuration: {
        total_variables: Object.keys(this.config).length,
        required_variables: Object.values(CONFIG_SCHEMA).filter(s => s.required).length,
        sensitive_variables: Object.keys(CONFIG_SCHEMA).filter(k => CONFIG_SCHEMA[k].sensitive).length
      },
      // Include full configuration for deployment tools (sensitive values masked)
      config_values: this.getMaskedConfig(),
      errors: this.errors,
      warnings: this.warnings
    };

    fs.writeFileSync('config-validation-report.json', JSON.stringify(report, null, 2));
    return report;
  }

  /**
   * Print validation results
   */
  printResults() {
    console.log('🔧 DDALAB Configuration Validation');
    console.log('=====================================');
    
    if (this.errors.length === 0) {
      console.log('✅ Configuration is valid!');
    } else {
      console.log('❌ Configuration has errors:');
      this.errors.forEach(error => console.log(`   - ${error}`));
    }

    if (this.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      this.warnings.forEach(warning => console.log(`   - ${warning}`));
    }

    console.log(`\n📊 Summary:`);
    console.log(`   - Environment: ${this.config.DDALAB_ENVIRONMENT || 'unknown'}`);
    console.log(`   - Variables configured: ${Object.keys(this.config).length}`);
    console.log(`   - Errors: ${this.errors.length}`);
    console.log(`   - Warnings: ${this.warnings.length}`);
  }
}

// CLI interface
function main() {
  const validator = new ConfigValidator();
  
  console.log('Loading configuration...');
  validator.loadConfig();
  
  console.log('Validating configuration...');
  validator.validate();
  
  console.log('Generating deployment configurations...');
  validator.generateConfigs();
  
  const report = validator.generateReport();
  validator.printResults();

  // Exit with error code if validation failed
  process.exit(validator.errors.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { ConfigValidator, CONFIG_SCHEMA };