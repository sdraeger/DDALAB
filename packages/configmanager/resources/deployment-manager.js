/**
 * DDALAB ConfigManager Deployment Integration
 * 
 * Integrates the new unified configuration system with ConfigManager
 * to ensure 100% reproducible deployments.
 */

const { ConfigValidator, CONFIG_SCHEMA } = require('../../../scripts/config-validator');
const { DeploymentGenerator } = require('../../../scripts/generate-deployment');
const { DeploymentChecker } = require('../../../scripts/deploy-check');

class ConfigManagerDeploymentIntegration {
  constructor() {
    this.validator = new ConfigValidator();
    this.config = {};
  }

  /**
   * Validate user configuration from ConfigManager UI
   */
  async validateConfiguration(userConfig) {
    // Merge user config with defaults
    this.config = { ...userConfig };
    
    // Apply ConfigManager-specific overrides
    this.config.DDALAB_ENVIRONMENT = 'production';
    this.config.DDALAB_DATA_DIR = `${userConfig.DDALAB_PROJECT_DIR}/data`;
    this.config.DDALAB_ALLOWED_DIRS = `${userConfig.DDALAB_PROJECT_DIR}/data`;
    this.config.DDALAB_DDA_BINARY_PATH = `${userConfig.DDALAB_PROJECT_DIR}/bin/run_DDA_ASCII`;
    
    // Run validation
    this.validator.config = this.config;
    this.validator.validate();
    
    return {
      valid: this.validator.errors.length === 0,
      errors: this.validator.errors,
      warnings: this.validator.warnings,
      config: this.config
    };
  }

  /**
   * Generate deployment package for ConfigManager
   */
  async generateDeployment(userConfig, outputPath) {
    const generator = new DeploymentGenerator('production', 'configmanager');
    
    // Override with user configuration
    generator.config = { ...generator.config, ...userConfig };
    
    // Generate deployment in specified path
    generator.outputDir = outputPath;
    await generator.generate();
    
    return {
      success: true,
      deploymentPath: outputPath,
      config: generator.config
    };
  }

  /**
   * Perform pre-deployment checks
   */
  async performDeploymentChecks() {
    const checker = new DeploymentChecker('docker-compose');
    await checker.runAllChecks();
    
    return {
      ready: checker.failures.length === 0,
      checks: checker.checks,
      failures: checker.failures
    };
  }

  /**
   * Get configuration schema for UI generation
   */
  getConfigurationSchema() {
    // Transform CONFIG_SCHEMA for ConfigManager UI
    const uiSchema = {};
    
    Object.entries(CONFIG_SCHEMA).forEach(([key, schema]) => {
      uiSchema[key] = {
        label: this.formatLabel(key),
        description: schema.description,
        required: schema.required,
        type: this.getUIType(schema),
        default: schema.default,
        sensitive: schema.sensitive,
        validation: this.getValidationRules(schema)
      };
    });
    
    return uiSchema;
  }

  formatLabel(key) {
    return key
      .replace('DDALAB_', '')
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  getUIType(schema) {
    if (schema.type === 'boolean') return 'checkbox';
    if (schema.type === 'number') return 'number';
    if (schema.type === 'path') return 'file';
    if (schema.type === 'path-list') return 'textarea';
    if (schema.sensitive) return 'password';
    if (schema.values) return 'select';
    return 'text';
  }

  getValidationRules(schema) {
    const rules = {};
    
    if (schema.required) rules.required = true;
    if (schema.minLength) rules.minLength = schema.minLength;
    if (schema.values) rules.options = schema.values;
    if (schema.type === 'number') rules.pattern = /^\d+$/;
    
    return rules;
  }

  /**
   * Create a reproducible deployment fingerprint
   */
  createDeploymentFingerprint(config) {
    const crypto = require('crypto');
    
    // Create deterministic fingerprint of configuration
    const configString = Object.keys(config)
      .sort()
      .filter(key => !CONFIG_SCHEMA[key]?.sensitive) // Exclude sensitive values
      .map(key => `${key}=${config[key]}`)
      .join('\n');
      
    const fingerprint = crypto
      .createHash('sha256')
      .update(configString)
      .digest('hex')
      .substring(0, 16);
    
    return {
      fingerprint,
      timestamp: new Date().toISOString(),
      environment: config.DDALAB_ENVIRONMENT,
      version: require('../../../package.json').version
    };
  }
}

module.exports = { ConfigManagerDeploymentIntegration };