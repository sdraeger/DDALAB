import { logger } from '../utils/logger-client';
import type { ElectronAPI } from '../utils/electron';

export interface HealthStatus {
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
  timestamp: string;
  checks: HealthCheck[];
  overallHealth: number; // 0-100 percentage
}

export interface HealthCheck {
  id: string;
  name: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  message: string;
  details?: any;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: 'installation' | 'docker' | 'configuration' | 'services' | 'storage';
  duration?: number; // ms
}

export interface HealthCheckConfig {
  enabled: boolean;
  intervalMs: number;
  timeoutMs: number;
  retryAttempts: number;
  notifyOnFailure: boolean;
  autoRecover: boolean;
}

interface HealthCheckContext {
  electronAPI?: ElectronAPI;
  userSelections?: any;
  isSetupComplete?: boolean;
}

class HealthCheckService {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private lastHealthStatus: HealthStatus | null = null;
  private healthListeners: Array<(status: HealthStatus) => void> = [];
  private isCheckInProgress = false;
  private lastCheckTime = 0;
  private lastStartTime = 0;
  private lastStopTime = 0;
  
  private config: HealthCheckConfig = {
    enabled: true,
    intervalMs: 30000, // 30 seconds - reduced frequency to prevent spam
    timeoutMs: 10000,  // 10 seconds
    retryAttempts: 1,  // Reduced retries
    notifyOnFailure: true,
    autoRecover: false,
  };

  private context: HealthCheckContext = {};

  constructor() {
    this.setupHealthChecks();
  }

  private setupHealthChecks() {
    // Listen for window focus to trigger immediate health check
    window.addEventListener('focus', () => {
      if (this.isRunning) {
        this.runHealthCheck();
      }
    });

    // Listen for online/offline events
    window.addEventListener('online', () => {
      logger.info('Network connection restored');
      this.runHealthCheck();
    });

    window.addEventListener('offline', () => {
      logger.warn('Network connection lost');
    });
  }

  start(context: HealthCheckContext = {}) {
    this.context = { ...this.context, ...context };
    
    if (this.isRunning) {
      logger.warn('Health check service is already running');
      return;
    }

    // Rate limiting: don't start more than once every 5 seconds
    const now = Date.now();
    if (now - this.lastStartTime < 5000) {
      logger.warn('Health check service start rate limited, ignoring request');
      return;
    }

    // Don't start immediately after stopping (prevent rapid restart loops)
    if (now - this.lastStopTime < 3000) {
      logger.warn('Health check service restart too soon after stop, ignoring request');
      return;
    }

    this.lastStartTime = now;

    logger.info('Starting health check service', {
      interval: this.config.intervalMs,
      timeout: this.config.timeoutMs,
    });

    this.isRunning = true;
    
    // Run immediate check for critical issues
    this.runInstallationValidation();
    
    // Run full health check after a short delay
    setTimeout(() => {
      this.runHealthCheck();
    }, 1000);

    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      this.runHealthCheck();
    }, this.config.intervalMs);
  }

  // Quick validation focused on installation integrity
  private async runInstallationValidation(): Promise<void> {
    try {
      logger.info('Running installation validation');
      
      const installationChecks = await this.checkInstallationDirectory();
      const criticalFailures = installationChecks.filter(
        check => check.status === 'fail' && check.priority === 'critical'
      );
      
      if (criticalFailures.length > 0) {
        const validationStatus: HealthStatus = {
          status: 'critical',
          timestamp: new Date().toISOString(),
          checks: installationChecks,
          overallHealth: 0,
        };
        
        // Immediately notify listeners about critical installation issues
        this.lastHealthStatus = validationStatus;
        this.healthListeners.forEach(listener => {
          try {
            listener(validationStatus);
          } catch (error) {
            logger.error('Error notifying health listener during validation:', error);
          }
        });
        
        // Show immediate notification for critical issues (if method is available)
        if (this.config.notifyOnFailure && this.context.electronAPI && this.context.electronAPI.showNotification) {
          const criticalMessages = criticalFailures.map(f => f.message).join('; ');
          try {
            await this.context.electronAPI.showNotification({
              title: 'DDALAB Installation Issue',
              body: `Critical installation problem detected: ${criticalMessages}`,
              type: 'error',
            });
          } catch (error) {
            logger.error('Failed to send critical installation notification:', error);
          }
        }
      }
    } catch (error) {
      logger.error('Installation validation failed:', error);
    }
  }

  stop() {
    if (!this.isRunning) return;

    // Rate limiting: don't stop more than once every 2 seconds
    const now = Date.now();
    if (now - this.lastStopTime < 2000) {
      logger.warn('Health check service stop rate limited, ignoring request');
      return;
    }

    this.lastStopTime = now;

    logger.info('Stopping health check service');
    
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  updateConfig(newConfig: Partial<HealthCheckConfig>) {
    this.config = { ...this.config, ...newConfig };
    
    if (this.isRunning) {
      this.stop();
      this.start(this.context);
    }
  }

  updateContext(context: Partial<HealthCheckContext>) {
    this.context = { ...this.context, ...context };
  }

  onHealthChange(listener: (status: HealthStatus) => void) {
    this.healthListeners.push(listener);
    
    // Send current status if available
    if (this.lastHealthStatus) {
      listener(this.lastHealthStatus);
    }
    
    return () => {
      const index = this.healthListeners.indexOf(listener);
      if (index > -1) {
        this.healthListeners.splice(index, 1);
      }
    };
  }

  async runHealthCheck(): Promise<HealthStatus> {
    // Prevent concurrent execution
    if (this.isCheckInProgress) {
      logger.debug('Health check already in progress, skipping');
      return this.lastHealthStatus || this.createEmptyHealthStatus();
    }

    // Rate limiting - don't run more than once every 10 seconds
    const now = Date.now();
    if (now - this.lastCheckTime < 10000) {
      logger.debug('Health check rate limited, skipping');
      return this.lastHealthStatus || this.createEmptyHealthStatus();
    }

    this.isCheckInProgress = true;
    this.lastCheckTime = now;
    
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    
    logger.info('Running health check');

    const checks: HealthCheck[] = [];

    try {
      // Run checks sequentially to avoid overwhelming the system
      checks.push(...await this.checkInstallationDirectory());
      checks.push(...await this.checkConfigurationFiles());
      
      // Only check Docker if installation checks pass
      const hasInstallationIssues = checks.some(check => 
        check.category === 'installation' && 
        check.status === 'fail' && 
        check.priority === 'critical'
      );
      
      if (!hasInstallationIssues) {
        checks.push(...await this.checkDockerInstallation());
        checks.push(...await this.checkStorageSpace());
        checks.push(...await this.checkNetworkConnectivity());
        checks.push(...await this.checkCertificates());
        checks.push(...await this.checkPermissions());
        
        // Only check Docker services if Docker is working
        const dockerWorks = checks.some(check => 
          check.id === 'docker_installed' && check.status === 'pass'
        );
        if (dockerWorks) {
          checks.push(...await this.checkDockerServices());
        }
      }

    } catch (error) {
      logger.error('Health check service error:', error);
      checks.push({
        id: 'health_service_error',
        name: 'Health Service Error',
        status: 'fail',
        message: `Health check service error: ${error}`,
        priority: 'high',
        category: 'services',
      });
    }

    // Calculate overall health
    const overallHealth = this.calculateOverallHealth(checks);
    const status = this.determineOverallStatus(checks, overallHealth);

    const healthStatus: HealthStatus = {
      status,
      timestamp,
      checks,
      overallHealth,
    };

    this.lastHealthStatus = healthStatus;
    
    // Notify listeners
    this.healthListeners.forEach(listener => {
      try {
        listener(healthStatus);
      } catch (error) {
        logger.error('Error notifying health listener:', error);
      }
    });

    // Handle notifications and recovery
    await this.handleHealthStatusChange(healthStatus);

    logger.info(`Health check completed in ${Date.now() - startTime}ms`, {
      status,
      overallHealth,
      checksCount: checks.length,
    });

    this.isCheckInProgress = false;
    return healthStatus;
  }

  private createEmptyHealthStatus(): HealthStatus {
    return {
      status: 'unknown',
      timestamp: new Date().toISOString(),
      checks: [],
      overallHealth: 0,
    };
  }

  private async checkInstallationDirectory(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    const { electronAPI, userSelections, isSetupComplete } = this.context;

    if (!electronAPI) {
      checks.push({
        id: 'installation_check_skipped',
        name: 'Installation Directory Check',
        status: 'skip',
        message: 'Electron API not available',
        priority: 'low',
        category: 'installation',
      });
      return checks;
    }

    try {
      // Always check for common DDALAB installation locations first
      const commonPaths = [
        '~/DDALAB',
        '~/Desktop/DDALAB',
        '/opt/DDALAB',
        '/usr/local/DDALAB'
      ];

      let foundCommonInstallation = false;
      for (const commonPath of commonPaths) {
        try {
          const expandedPath = commonPath.replace('~', require('os').homedir());
          const exists = await electronAPI.checkDirectoryExists(expandedPath);
          if (exists) {
            foundCommonInstallation = true;
            checks.push({
              id: 'common_installation_found',
              name: 'DDALAB Installation Found',
              status: 'pass',
              message: `DDALAB installation found at: ${expandedPath}`,
              priority: 'high',
              category: 'installation',
              details: { path: expandedPath, exists: true },
            });
            break;
          }
        } catch (error) {
          // Continue checking other paths
        }
      }

      // Only report missing common installation if there's no valid project location configured
      if (!foundCommonInstallation && (!userSelections?.projectLocation || !isSetupComplete)) {
        checks.push({
          id: 'common_installation_missing',
          name: 'DDALAB Installation',
          status: isSetupComplete ? 'warn' : 'skip',
          message: 'No DDALAB installation found in common locations. Using configured project location.',
          priority: 'low',
          category: 'installation',
          details: { 
            checkedPaths: commonPaths,
            isSetupComplete,
            hasProjectLocation: !!userSelections?.projectLocation,
            suggestion: 'Installation is using custom location'
          },
        });
      }

      // Check user-configured data directory
      if (userSelections?.dataLocation) {
        const startTime = Date.now();
        const exists = await electronAPI.checkDirectoryExists(userSelections.dataLocation);
        const duration = Date.now() - startTime;

        checks.push({
          id: 'data_directory_exists',
          name: 'Configured Data Directory',
          status: exists ? 'pass' : 'fail',
          message: exists 
            ? `Configured data directory exists: ${userSelections.dataLocation}`
            : `Configured data directory missing: ${userSelections.dataLocation}. The DDALAB installation may have been deleted or moved.`,
          priority: 'critical',
          category: 'installation',
          duration,
          details: { 
            path: userSelections.dataLocation, 
            exists,
            isConfigured: true,
            recoveryAction: exists ? null : 'reinstall_or_reconfigure'
          },
        });

        if (exists) {
          // Check if directory is writable (if method is available)
          try {
            if (electronAPI.isDirectoryWritable) {
              const isWritable = await electronAPI.isDirectoryWritable(userSelections.dataLocation);
              checks.push({
                id: 'data_directory_writable',
                name: 'Data Directory Permissions',
                status: isWritable ? 'pass' : 'warn',
                message: isWritable 
                  ? 'Data directory is writable'
                  : 'Data directory may not be writable',
                priority: 'high',
                category: 'installation',
                details: { path: userSelections.dataLocation, writable: isWritable },
              });
            } else {
              checks.push({
                id: 'data_directory_permissions_skipped',
                name: 'Data Directory Permissions',
                status: 'skip',
                message: 'Permission check not available',
                priority: 'low',
                category: 'installation',
              });
            }
          } catch (error) {
            checks.push({
              id: 'data_directory_permissions_error',
              name: 'Data Directory Permissions',
              status: 'warn',
              message: `Could not check directory permissions: ${error}`,
              priority: 'medium',
              category: 'installation',
              details: { error: error?.toString() },
            });
          }

          // Check for essential DDALAB files within the directory
          // For Docker deployments, we only need the deployment files
          const essentialFiles = userSelections?.setupType === 'docker' 
            ? ['docker-compose.yml', '.env']
            : ['docker-compose.yml', '.env', 'packages/api', 'packages/web'];

          // For Docker deployments, check files in projectLocation, otherwise in dataLocation
          const checkPath = userSelections?.setupType === 'docker' && userSelections?.projectLocation
            ? userSelections.projectLocation
            : userSelections.dataLocation;
            
          for (const file of essentialFiles) {
            const filePath = `${checkPath}/${file}`;
            try {
              const fileExists = await electronAPI.checkFileExists(filePath);
              checks.push({
                id: `essential_file_${file.replace(/[^a-z0-9]/gi, '_')}`,
                name: `Essential File: ${file}`,
                status: fileExists ? 'pass' : 'fail',
                message: fileExists 
                  ? `${file} found`
                  : `${file} missing - DDALAB installation appears incomplete`,
                priority: fileExists ? 'low' : 'high',
                category: 'installation',
                details: { path: filePath, exists: fileExists, essential: true },
              });
            } catch (error) {
              // Don't fail if we can't check a specific file
            }
          }
        } else {
          // If data directory doesn't exist, provide helpful recovery suggestions
          checks.push({
            id: 'missing_installation_recovery',
            name: 'Installation Recovery Options',
            status: 'fail',
            message: 'DDALAB installation not found. You may need to re-run the setup process or restore from backup.',
            priority: 'critical',
            category: 'installation',
            details: {
              missingPath: userSelections.dataLocation,
              recoveryOptions: [
                'Run ConfigManager setup again',
                'Restore DDALAB directory from backup',
                'Check if directory was moved to different location',
                'Verify disk space and permissions'
              ]
            },
          });
        }
      } else if (isSetupComplete) {
        // Setup is marked complete but no data location configured
        checks.push({
          id: 'missing_data_location_config',
          name: 'Data Location Configuration',
          status: 'fail',
          message: 'Setup appears complete but no data location is configured',
          priority: 'critical',
          category: 'installation',
          details: {
            isSetupComplete,
            hasDataLocation: false,
            suggestion: 'Re-run setup to configure data location'
          },
        });
      }

      // Check project directory (for all setup types)
      if (userSelections?.projectLocation) {
        const startTime = Date.now();
        const exists = await electronAPI.checkDirectoryExists(userSelections.projectLocation);
        const duration = Date.now() - startTime;

        checks.push({
          id: 'project_directory_exists',
          name: 'Project Directory',
          status: exists ? 'pass' : 'fail',
          message: exists 
            ? `Project directory exists: ${userSelections.projectLocation}`
            : `Project directory missing: ${userSelections.projectLocation}`,
          priority: 'critical',
          category: 'installation',
          duration,
          details: { path: userSelections.projectLocation, exists },
        });
      }

    } catch (error) {
      checks.push({
        id: 'installation_check_error',
        name: 'Installation Directory Check',
        status: 'fail',
        message: `Failed to check installation directories: ${error}`,
        priority: 'high',
        category: 'installation',
        details: { error: error?.toString() },
      });
    }

    return checks;
  }

  private async checkConfigurationFiles(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    const { electronAPI, userSelections } = this.context;

    if (!electronAPI || !userSelections?.dataLocation) {
      checks.push({
        id: 'config_check_skipped',
        name: 'Configuration Files Check',
        status: 'skip',
        message: 'Configuration check requirements not met',
        priority: 'low',
        category: 'configuration',
      });
      return checks;
    }

    try {
      // For Docker deployments, configuration files are in projectLocation
      const configPath = userSelections?.setupType === 'docker' && userSelections?.projectLocation
        ? userSelections.projectLocation
        : userSelections.dataLocation;
        
      const configFiles = [
        { name: '.env', path: `${configPath}/.env`, required: true },
        { name: 'docker-compose.yml', path: `${configPath}/docker-compose.yml`, required: true },
        { name: 'certs directory', path: `${configPath}/certs`, required: false },
      ];

      for (const file of configFiles) {
        const startTime = Date.now();
        const pathCheck = await electronAPI.checkPath(file.path);
        const exists = pathCheck.exists;
        const duration = Date.now() - startTime;

        checks.push({
          id: `config_file_${file.name.replace(/[^a-z0-9]/gi, '_')}`,
          name: `Configuration: ${file.name}`,
          status: exists ? 'pass' : (file.required ? 'fail' : 'warn'),
          message: exists 
            ? `${file.name} exists`
            : `${file.name} ${file.required ? 'missing (required)' : 'missing (optional)'}`,
          priority: file.required ? 'high' : 'medium',
          category: 'configuration',
          duration,
          details: { path: file.path, exists, required: file.required },
        });
      }

    } catch (error) {
      checks.push({
        id: 'config_check_error',
        name: 'Configuration Files Check',
        status: 'fail',
        message: `Failed to check configuration files: ${error}`,
        priority: 'medium',
        category: 'configuration',
        details: { error: error?.toString() },
      });
    }

    return checks;
  }

  private async checkDockerInstallation(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    const { electronAPI } = this.context;

    if (!electronAPI) {
      checks.push({
        id: 'docker_check_skipped',
        name: 'Docker Installation Check',
        status: 'skip',
        message: 'Electron API not available',
        priority: 'low',
        category: 'docker',
      });
      return checks;
    }

    try {
      const startTime = Date.now();
      
      // Use a timeout to prevent hanging
      const checkPromise = electronAPI.checkDockerInstallation();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Docker check timeout')), this.config.timeoutMs);
      });
      
      const dockerStatus = await Promise.race([checkPromise, timeoutPromise]) as any;
      const duration = Date.now() - startTime;

      // Handle the case where Docker is installed but Docker Compose isn't
      const hasDockerCompose = dockerStatus.dockerComposeInstalled === true;
      
      checks.push({
        id: 'docker_installed',
        name: 'Docker Installation',
        status: dockerStatus.dockerInstalled ? 'pass' : 'fail',
        message: dockerStatus.dockerInstalled 
          ? `Docker is installed (${dockerStatus.dockerVersion || 'unknown version'})`
          : 'Docker is not installed',
        priority: 'high', // Reduced from critical to prevent spam
        category: 'docker',
        duration,
        details: dockerStatus,
      });

      if (dockerStatus.dockerInstalled) {
        checks.push({
          id: 'docker_compose_installed',
          name: 'Docker Compose',
          status: hasDockerCompose ? 'pass' : 'warn',
          message: hasDockerCompose 
            ? `Docker Compose is available (${dockerStatus.dockerComposeVersion || 'unknown version'})`
            : 'Docker Compose not found - may need to use legacy docker-compose command',
          priority: 'medium',
          category: 'docker',
          details: { 
            composeInstalled: hasDockerCompose,
            suggestion: !hasDockerCompose ? 'Install Docker Compose plugin or use docker-compose (with hyphen)' : null
          },
        });

        checks.push({
          id: 'docker_running',
          name: 'Docker Service',
          status: dockerStatus.running ? 'pass' : 'warn',
          message: dockerStatus.running 
            ? 'Docker service is running'
            : 'Docker service is not running',
          priority: 'high',
          category: 'docker',
          details: { running: dockerStatus.running },
        });
      }

    } catch (error) {
      const errorMessage = error?.toString() || 'Unknown error';
      
      // Don't treat timeouts as critical failures
      const isTimeout = errorMessage.includes('timeout');
      
      checks.push({
        id: 'docker_check_error',
        name: 'Docker Installation Check',
        status: isTimeout ? 'warn' : 'fail',
        message: isTimeout 
          ? 'Docker check timed out - may be slow to respond'
          : `Failed to check Docker installation: ${errorMessage}`,
        priority: isTimeout ? 'medium' : 'high',
        category: 'docker',
        details: { error: errorMessage, timeout: isTimeout },
      });
    }

    return checks;
  }

  private async checkDockerServices(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    const { electronAPI, userSelections } = this.context;

    if (!electronAPI || !userSelections?.dataLocation) {
      checks.push({
        id: 'docker_services_check_skipped',
        name: 'Docker Services Check',
        status: 'skip',
        message: 'Docker services check requirements not met',
        priority: 'low',
        category: 'services',
      });
      return checks;
    }

    try {
      const startTime = Date.now();
      
      // Use timeout to prevent hanging
      const statusPromise = electronAPI.getDockerStatus(userSelections.dataLocation);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Docker services check timeout')), this.config.timeoutMs);
      });
      
      const status = await Promise.race([statusPromise, timeoutPromise]) as any;
      const duration = Date.now() - startTime;

      if (status && typeof status === 'object') {
        const services = ['ddalab', 'postgres', 'redis', 'minio', 'traefik'];
        
        services.forEach(serviceName => {
          const serviceStatus = status[serviceName as keyof typeof status];
          if (serviceStatus !== undefined) {
            checks.push({
              id: `docker_service_${serviceName}`,
              name: `Docker Service: ${serviceName}`,
              status: serviceStatus ? 'pass' : 'warn',
              message: serviceStatus 
                ? `${serviceName} service is running`
                : `${serviceName} service is not running`,
              priority: serviceName === 'ddalab' ? 'high' : 'medium',
              category: 'services',
              details: { service: serviceName, running: serviceStatus },
            });
          }
        });
      } else {
        checks.push({
          id: 'docker_services_status',
          name: 'Docker Services Status',
          status: 'warn',
          message: 'Could not retrieve Docker services status',
          priority: 'medium',
          category: 'services',
          duration,
          details: { status },
        });
      }

    } catch (error) {
      checks.push({
        id: 'docker_services_error',
        name: 'Docker Services Check',
        status: 'warn',
        message: `Failed to check Docker services: ${error}`,
        priority: 'medium',
        category: 'services',
        details: { error: error?.toString() },
      });
    }

    return checks;
  }

  private async checkStorageSpace(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    const { electronAPI, userSelections } = this.context;

    if (!electronAPI || !userSelections?.dataLocation) {
      checks.push({
        id: 'storage_check_skipped',
        name: 'Storage Space Check',
        status: 'skip',
        message: 'Storage check requirements not met',
        priority: 'low',
        category: 'storage',
      });
      return checks;
    }

    try {
      const startTime = Date.now();
      
      // Skip disk space check if method not available
      if (!electronAPI.getDiskSpace) {
        checks.push({
          id: 'storage_check_skipped',
          name: 'Storage Space Check',
          status: 'skip',
          message: 'Disk space check not available',
          priority: 'low',
          category: 'storage',
        });
        return checks;
      }
      
      const diskSpace = await electronAPI.getDiskSpace(userSelections.dataLocation);
      const duration = Date.now() - startTime;

      if (diskSpace) {
        const freeSpaceGB = diskSpace.free / (1024 ** 3);
        const totalSpaceGB = diskSpace.size / (1024 ** 3);
        const usagePercent = ((diskSpace.size - diskSpace.free) / diskSpace.size) * 100;

        let status: 'pass' | 'warn' | 'fail' = 'pass';
        let message = `${freeSpaceGB.toFixed(1)} GB free (${usagePercent.toFixed(1)}% used)`;

        if (freeSpaceGB < 1) {
          status = 'fail';
          message += ' - Critical: Less than 1 GB free';
        } else if (freeSpaceGB < 5) {
          status = 'warn';
          message += ' - Warning: Less than 5 GB free';
        }

        checks.push({
          id: 'storage_space',
          name: 'Storage Space',
          status,
          message,
          priority: status === 'fail' ? 'critical' : (status === 'warn' ? 'high' : 'medium'),
          category: 'storage',
          duration,
          details: {
            free: diskSpace.free,
            total: diskSpace.size,
            freeGB: freeSpaceGB,
            totalGB: totalSpaceGB,
            usagePercent,
          },
        });
      }

    } catch (error) {
      checks.push({
        id: 'storage_check_error',
        name: 'Storage Space Check',
        status: 'warn',
        message: `Failed to check storage space: ${error}`,
        priority: 'low',
        category: 'storage',
        details: { error: error?.toString() },
      });
    }

    return checks;
  }

  private async checkNetworkConnectivity(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];

    try {
      const startTime = Date.now();
      const isOnline = navigator.onLine;
      const duration = Date.now() - startTime;

      checks.push({
        id: 'network_connectivity',
        name: 'Network Connectivity',
        status: isOnline ? 'pass' : 'warn',
        message: isOnline ? 'Network is available' : 'Network appears to be offline',
        priority: 'medium',
        category: 'services',
        duration,
        details: { online: isOnline },
      });

    } catch (error) {
      checks.push({
        id: 'network_check_error',
        name: 'Network Connectivity Check',
        status: 'warn',
        message: `Failed to check network connectivity: ${error}`,
        priority: 'low',
        category: 'services',
        details: { error: error?.toString() },
      });
    }

    return checks;
  }

  private async checkCertificates(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    const { electronAPI, userSelections } = this.context;

    if (!electronAPI || !userSelections?.dataLocation) {
      checks.push({
        id: 'certs_check_skipped',
        name: 'Certificates Check',
        status: 'skip',
        message: 'Certificates check requirements not met',
        priority: 'low',
        category: 'configuration',
      });
      return checks;
    }

    try {
      // For Docker deployments, certificates are in projectLocation
      const configPath = userSelections?.setupType === 'docker' && userSelections?.projectLocation
        ? userSelections.projectLocation
        : userSelections.dataLocation;
      const certsPath = `${configPath}/certs`;
      const certFiles = ['server.crt', 'server.key', 'ca.crt'];

      for (const certFile of certFiles) {
        const startTime = Date.now();
        const certPath = `${certsPath}/${certFile}`;
        const exists = await electronAPI.checkFileExists(certPath);
        const duration = Date.now() - startTime;

        checks.push({
          id: `cert_file_${certFile.replace('.', '_')}`,
          name: `Certificate: ${certFile}`,
          status: exists ? 'pass' : 'warn',
          message: exists 
            ? `${certFile} exists`
            : `${certFile} missing - SSL may not work properly`,
          priority: 'medium',
          category: 'configuration',
          duration,
          details: { path: certPath, exists },
        });
      }

    } catch (error) {
      checks.push({
        id: 'certs_check_error',
        name: 'Certificates Check',
        status: 'warn',
        message: `Failed to check certificates: ${error}`,
        priority: 'low',
        category: 'configuration',
        details: { error: error?.toString() },
      });
    }

    return checks;
  }

  private async checkPermissions(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    const { electronAPI, userSelections } = this.context;

    if (!electronAPI || !userSelections?.dataLocation) {
      checks.push({
        id: 'permissions_check_skipped',
        name: 'Permissions Check',
        status: 'skip',
        message: 'Permissions check requirements not met',
        priority: 'low',
        category: 'installation',
      });
      return checks;
    }

    try {
      const startTime = Date.now();
      
      // Skip permissions check if method not available
      if (!electronAPI.isDirectoryWritable) {
        checks.push({
          id: 'permissions_check_not_available',
          name: 'Directory Permissions',
          status: 'skip',
          message: 'Permission check method not available',
          priority: 'low',
          category: 'installation',
        });
        return checks;
      }
      
      const canWrite = await electronAPI.isDirectoryWritable(userSelections.dataLocation);
      const duration = Date.now() - startTime;

      checks.push({
        id: 'directory_permissions',
        name: 'Directory Permissions',
        status: canWrite ? 'pass' : 'fail',
        message: canWrite 
          ? 'Directory has proper write permissions'
          : 'Directory lacks write permissions',
        priority: 'high',
        category: 'installation',
        duration,
        details: { path: userSelections.dataLocation, writable: canWrite },
      });

    } catch (error) {
      checks.push({
        id: 'permissions_check_error',
        name: 'Permissions Check',
        status: 'warn',
        message: `Failed to check permissions: ${error}`,
        priority: 'medium',
        category: 'installation',
        details: { error: error?.toString() },
      });
    }

    return checks;
  }

  private calculateOverallHealth(checks: HealthCheck[]): number {
    if (checks.length === 0) return 0;

    const weights = {
      critical: 20,
      high: 10,
      medium: 5,
      low: 1,
    };

    const scores = {
      pass: 1,
      warn: 0.5,
      fail: 0,
      skip: 1,
    };

    let totalWeight = 0;
    let weightedScore = 0;

    checks.forEach(check => {
      const weight = weights[check.priority];
      const score = scores[check.status];
      totalWeight += weight;
      weightedScore += weight * score;
    });

    return totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;
  }

  private determineOverallStatus(checks: HealthCheck[], overallHealth: number): HealthStatus['status'] {
    const criticalFailures = checks.filter(c => c.status === 'fail' && c.priority === 'critical').length;
    const highFailures = checks.filter(c => c.status === 'fail' && c.priority === 'high').length;
    const warnings = checks.filter(c => c.status === 'warn').length;

    if (criticalFailures > 0 || overallHealth < 30) {
      return 'critical';
    } else if (highFailures > 0 || warnings > 2 || overallHealth < 70) {
      return 'warning';
    } else if (overallHealth > 90) {
      return 'healthy';
    } else {
      return 'warning';
    }
  }

  private async handleHealthStatusChange(healthStatus: HealthStatus) {
    const { config } = this;
    const previousStatus = this.lastHealthStatus?.status;

    // Log status changes
    if (previousStatus && previousStatus !== healthStatus.status) {
      logger.info(`Health status changed: ${previousStatus} -> ${healthStatus.status}`);
    }

    // Send notifications for critical issues (if method is available)
    if (config.notifyOnFailure && this.context.electronAPI && this.context.electronAPI.showNotification) {
      const criticalFailures = healthStatus.checks.filter(
        c => c.status === 'fail' && c.priority === 'critical'
      );

      if (criticalFailures.length > 0) {
        const message = criticalFailures.map(f => f.message).join('; ');
        try {
          await this.context.electronAPI.showNotification({
            title: 'DDALAB Health Check Alert',
            body: `Critical issues detected: ${message}`,
            type: 'error',
          });
        } catch (error) {
          logger.error('Failed to send health notification:', error);
        }
      }
    }

    // Auto-recovery attempts
    if (config.autoRecover && healthStatus.status === 'critical') {
      logger.info('Attempting auto-recovery for critical health issues');
      await this.attemptAutoRecovery(healthStatus);
    }
  }

  private async attemptAutoRecovery(healthStatus: HealthStatus) {
    const criticalChecks = healthStatus.checks.filter(
      c => c.status === 'fail' && c.priority === 'critical'
    );

    for (const check of criticalChecks) {
      try {
        switch (check.id) {
          case 'data_directory_exists':
            if (this.context.electronAPI && this.context.electronAPI.createDirectory && check.details?.path) {
              logger.info(`Attempting to create missing directory: ${check.details.path}`);
              await this.context.electronAPI.createDirectory(check.details.path);
            } else {
              logger.info('Directory creation method not available for auto-recovery');
            }
            break;
          case 'docker_installed':
            logger.info('Docker not installed - cannot auto-recover, user intervention required');
            break;
          default:
            logger.info(`No auto-recovery available for check: ${check.id}`);
        }
      } catch (error) {
        logger.error(`Auto-recovery failed for ${check.id}:`, error);
      }
    }
  }

  getLastHealthStatus(): HealthStatus | null {
    return this.lastHealthStatus;
  }

  isHealthy(): boolean {
    return this.lastHealthStatus?.status === 'healthy' || 
           this.lastHealthStatus?.overallHealth > 70;
  }
}

export const healthCheckService = new HealthCheckService();

export default healthCheckService;