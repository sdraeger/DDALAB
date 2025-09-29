import { invoke } from '@tauri-apps/api/core'

export interface DockerService {
  name: string
  status: ServiceStatus
  health: HealthStatus
  ports: string[]
  last_updated: string
}

export enum ServiceStatus {
  Running = 'Running',
  Stopped = 'Stopped',
  Starting = 'Starting',
  Stopping = 'Stopping',
  Error = 'Error',
  Unknown = 'Unknown'
}

export enum HealthStatus {
  Healthy = 'Healthy',
  Unhealthy = 'Unhealthy',
  Starting = 'Starting',
  Unknown = 'Unknown'
}

export interface DockerStackStatus {
  services: DockerService[]
  is_running: boolean
  setup_directory: string | null
  last_checked: string
}

export interface DockerStackConfig {
  db_user: string
  db_password: string
  db_name: string
  minio_user: string
  minio_password: string
  jwt_secret: string
  api_image: string
  environment: string
  debug: boolean
}

export interface DockerRequirements {
  docker: boolean
  docker_compose: boolean
}

export class DockerStackService {
  /**
   * Setup the Docker stack repository and configuration
   */
  static async setupDockerStack(): Promise<DockerStackStatus> {
    try {
      return await invoke<DockerStackStatus>('setup_docker_stack')
    } catch (error) {
      console.error('Failed to setup Docker stack:', error)
      throw new Error(`Setup failed: ${error}`)
    }
  }

  /**
   * Start the Docker stack services
   */
  static async startDockerStack(): Promise<DockerStackStatus> {
    try {
      return await invoke<DockerStackStatus>('start_docker_stack')
    } catch (error) {
      console.error('Failed to start Docker stack:', error)
      throw new Error(`Start failed: ${error}`)
    }
  }

  /**
   * Stop the Docker stack services
   */
  static async stopDockerStack(): Promise<DockerStackStatus> {
    try {
      return await invoke<DockerStackStatus>('stop_docker_stack')
    } catch (error) {
      console.error('Failed to stop Docker stack:', error)
      throw new Error(`Stop failed: ${error}`)
    }
  }

  /**
   * Get current Docker stack status
   */
  static async getDockerStackStatus(): Promise<DockerStackStatus> {
    try {
      return await invoke<DockerStackStatus>('get_docker_stack_status')
    } catch (error) {
      console.error('Failed to get Docker stack status:', error)
      throw new Error(`Status check failed: ${error}`)
    }
  }

  /**
   * Check if Docker and Docker Compose are available
   */
  static async checkDockerRequirements(): Promise<DockerRequirements> {
    try {
      return await invoke<DockerRequirements>('check_docker_requirements')
    } catch (error) {
      console.error('Failed to check Docker requirements:', error)
      throw new Error(`Requirements check failed: ${error}`)
    }
  }

  /**
   * Update Docker stack configuration
   */
  static async updateDockerConfig(config: DockerStackConfig): Promise<void> {
    try {
      return await invoke<void>('update_docker_config', { config })
    } catch (error) {
      console.error('Failed to update Docker config:', error)
      throw new Error(`Config update failed: ${error}`)
    }
  }

  /**
   * Check if the API server is responding
   */
  static async checkApiHealth(apiUrl: string = 'http://localhost:8000'): Promise<boolean> {
    try {
      const response = await fetch(`${apiUrl}/health`)
      return response.ok
    } catch (error) {
      console.warn('API health check failed:', error)
      return false
    }
  }

  /**
   * Get human readable status for a service
   */
  static getServiceStatusText(status: ServiceStatus): string {
    switch (status) {
      case ServiceStatus.Running:
        return 'Running'
      case ServiceStatus.Stopped:
        return 'Stopped'
      case ServiceStatus.Starting:
        return 'Starting...'
      case ServiceStatus.Stopping:
        return 'Stopping...'
      case ServiceStatus.Error:
        return 'Error'
      default:
        return 'Unknown'
    }
  }

  /**
   * Get human readable health status
   */
  static getHealthStatusText(health: HealthStatus): string {
    switch (health) {
      case HealthStatus.Healthy:
        return 'Healthy'
      case HealthStatus.Unhealthy:
        return 'Unhealthy'
      case HealthStatus.Starting:
        return 'Starting...'
      default:
        return 'Unknown'
    }
  }

  /**
   * Get status color for UI display
   */
  static getStatusColor(status: ServiceStatus): string {
    switch (status) {
      case ServiceStatus.Running:
        return 'text-green-600'
      case ServiceStatus.Stopped:
        return 'text-gray-500'
      case ServiceStatus.Starting:
        return 'text-blue-500'
      case ServiceStatus.Stopping:
        return 'text-yellow-500'
      case ServiceStatus.Error:
        return 'text-red-600'
      default:
        return 'text-gray-400'
    }
  }

  /**
   * Get health color for UI display
   */
  static getHealthColor(health: HealthStatus): string {
    switch (health) {
      case HealthStatus.Healthy:
        return 'text-green-600'
      case HealthStatus.Unhealthy:
        return 'text-red-600'
      case HealthStatus.Starting:
        return 'text-blue-500'
      default:
        return 'text-gray-400'
    }
  }

  /**
   * Generate a secure password
   */
  static generateSecurePassword(length: number = 24): string {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
    let password = ''
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length))
    }
    return password
  }

  /**
   * Get default Docker configuration
   */
  static getDefaultConfig(): DockerStackConfig {
    return {
      db_user: 'ddalab',
      db_password: this.generateSecurePassword(),
      db_name: 'ddalab',
      minio_user: 'minioadmin',
      minio_password: this.generateSecurePassword(),
      jwt_secret: this.generateSecurePassword(32),
      api_image: 'sdraeger1/ddalab-api:latest',
      environment: 'development',
      debug: true
    }
  }

  /**
   * Validate configuration
   */
  static validateConfig(config: DockerStackConfig): string[] {
    const errors: string[] = []

    if (!config.db_user || config.db_user.length < 3) {
      errors.push('Database user must be at least 3 characters')
    }

    if (!config.db_password || config.db_password.length < 8) {
      errors.push('Database password must be at least 8 characters')
    }

    if (!config.db_name || config.db_name.length < 3) {
      errors.push('Database name must be at least 3 characters')
    }

    if (!config.minio_user || config.minio_user.length < 3) {
      errors.push('MinIO user must be at least 3 characters')
    }

    if (!config.minio_password || config.minio_password.length < 8) {
      errors.push('MinIO password must be at least 8 characters')
    }

    if (!config.jwt_secret || config.jwt_secret.length < 16) {
      errors.push('JWT secret must be at least 16 characters')
    }

    if (!config.api_image || !config.api_image.includes(':')) {
      errors.push('API image must include a tag (e.g., sdraeger1/ddalab-api:latest)')
    }

    return errors
  }
}
