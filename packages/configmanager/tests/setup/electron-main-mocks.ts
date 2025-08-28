/**
 * Mock helpers for the Electron main process to recognize virtualized test environment
 * This file provides guidance for main process modifications needed for testing
 */

export interface TestEnvironmentConfig {
  isTestMode: boolean;
  testDataPath: string;
  mockDockerStatus: string;
  mockProjectConfigured: boolean;
  disableRealFileOperations: boolean;
}

export function getTestEnvironmentConfig(): TestEnvironmentConfig {
  return {
    isTestMode: process.env.TEST_VIRTUALIZED_ENV === 'true',
    testDataPath: process.env.TEST_DATA_PATH || '',
    mockDockerStatus: process.env.MOCK_DOCKER_STATUS || 'stopped',
    mockProjectConfigured: process.env.MOCK_PROJECT_CONFIGURED === 'true',
    disableRealFileOperations: process.env.DISABLE_REAL_FILE_OPERATIONS === 'true'
  };
}

/**
 * Mock implementations that the main process should use when in test mode
 */
export const TestMocks = {
  // Mock Docker status check
  getDockerStatus: () => {
    const config = getTestEnvironmentConfig();
    if (config.isTestMode) {
      return {
        isInstalled: true,
        isRunning: config.mockDockerStatus === 'running',
        version: '20.10.0-test',
        containers: config.mockDockerStatus === 'running' ? [
          { name: 'ddalab-web', status: 'running' },
          { name: 'ddalab-api', status: 'running' },
          { name: 'ddalab-db', status: 'running' }
        ] : []
      };
    }
    return null; // Use real implementation
  },

  // Mock file system operations
  getProjectConfiguration: () => {
    const config = getTestEnvironmentConfig();
    if (config.isTestMode && config.mockProjectConfigured) {
      return {
        isFirstRun: false,
        hasCompletedSetup: true,
        projectPath: config.testDataPath,
        dockerInstalled: true,
        dockerRunning: config.mockDockerStatus === 'running',
        servicesConfigured: true,
        certificatesInstalled: true
      };
    }
    return null; // Use real implementation
  },

  // Mock directory dialog
  showDirectoryDialog: () => {
    const config = getTestEnvironmentConfig();
    if (config.isTestMode && config.disableRealFileOperations) {
      const os = require('os');
      const homeDir = os.homedir();
      return {
        canceled: false,
        filePaths: [homeDir]
      };
    }
    return null; // Use real implementation
  }
};

/**
 * Instructions for integrating these mocks into the main process:
 * 
 * 1. In your main process files, check if you're in test mode:
 *    ```typescript
 *    import { getTestEnvironmentConfig, TestMocks } from './tests/setup/electron-main-mocks';
 *    
 *    const testConfig = getTestEnvironmentConfig();
 *    if (testConfig.isTestMode) {
 *      // Use mock implementations
 *    }
 *    ```
 * 
 * 2. For Docker operations, use the mock status:
 *    ```typescript
 *    const dockerStatus = TestMocks.getDockerStatus() || getRealDockerStatus();
 *    ```
 * 
 * 3. For file dialogs, use mock paths:
 *    ```typescript
 *    const dialogResult = TestMocks.showDirectoryDialog() || dialog.showOpenDialog(...);
 *    ```
 * 
 * 4. For configuration loading, use mock config:
 *    ```typescript
 *    const config = TestMocks.getProjectConfiguration() || loadRealConfiguration();
 *    ```
 */