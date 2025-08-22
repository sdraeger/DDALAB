import { exec, spawn, ExecOptions, SpawnOptions } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

const execAsync = promisify(exec);

interface ShellInfo {
  shell: string;
  isAvailable: boolean;
  priority: number;
}

interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code?: number;
}

class ShellUtility {
  private detectedShell: string | null = null;
  private shellDetectionPromise: Promise<string> | null = null;

  // Shell priority order by platform
  private readonly SHELL_CANDIDATES = {
    win32: [
      { shell: 'powershell.exe', args: ['-Command'], priority: 1 },
      { shell: 'cmd.exe', args: ['/c'], priority: 2 },
      { shell: 'cmd', args: ['/c'], priority: 3 }
    ],
    unix: [
      { shell: '/bin/bash', args: ['-c'], priority: 1 },
      { shell: '/bin/zsh', args: ['-c'], priority: 2 },
      { shell: '/bin/sh', args: ['-c'], priority: 3 },
      { shell: '/usr/bin/bash', args: ['-c'], priority: 4 },
      { shell: '/usr/local/bin/bash', args: ['-c'], priority: 5 },
      { shell: 'bash', args: ['-c'], priority: 6 },
      { shell: 'zsh', args: ['-c'], priority: 7 },
      { shell: 'sh', args: ['-c'], priority: 8 },
      // Fish shell has different syntax, use with lower priority
      { shell: '/usr/local/bin/fish', args: ['-c'], priority: 20 },
      { shell: '/opt/homebrew/bin/fish', args: ['-c'], priority: 21 },
      { shell: 'fish', args: ['-c'], priority: 22 }
    ]
  };

  /**
   * Detect the best available shell for the current platform
   */
  async detectShell(): Promise<string> {
    if (this.detectedShell) {
      return this.detectedShell;
    }

    if (this.shellDetectionPromise) {
      return this.shellDetectionPromise;
    }

    this.shellDetectionPromise = this._performShellDetection();
    this.detectedShell = await this.shellDetectionPromise;
    return this.detectedShell;
  }

  private async _performShellDetection(): Promise<string> {
    const platform = process.platform;
    logger.debug(`Detecting shell for platform: ${platform}`);

    // Windows platform
    if (platform === 'win32') {
      return this._detectWindowsShell();
    }

    // Unix-like platforms (macOS, Linux, etc.)
    return this._detectUnixShell();
  }

  private async _detectWindowsShell(): Promise<string> {
    const candidates = this.SHELL_CANDIDATES.win32;
    
    for (const candidate of candidates.sort((a, b) => a.priority - b.priority)) {
      try {
        // Try to execute a simple command to test if shell is available
        await this._testShell(candidate.shell, candidate.args, 'echo test');
        logger.info(`Detected Windows shell: ${candidate.shell}`);
        return candidate.shell;
      } catch (error) {
        logger.debug(`Shell ${candidate.shell} not available:`, error);
      }
    }

    // Fallback to cmd.exe (should always be available on Windows)
    logger.warn('No preferred shell detected, falling back to cmd.exe');
    return 'cmd.exe';
  }

  private async _detectUnixShell(): Promise<string> {
    const candidates = this.SHELL_CANDIDATES.unix;

    // First, try using the SHELL environment variable, but skip fish shell
    const envShell = process.env.SHELL;
    if (envShell && !envShell.includes('fish') && await this._isShellAvailable(envShell)) {
      logger.info(`Using shell from SHELL environment variable: ${envShell}`);
      return envShell;
    }

    // Test each candidate shell, prefer bash/zsh/sh over fish
    for (const candidate of candidates.sort((a, b) => a.priority - b.priority)) {
      if (await this._isShellAvailable(candidate.shell)) {
        logger.info(`Detected Unix shell: ${candidate.shell}`);
        return candidate.shell;
      }
    }

    // Ultimate fallback - try to find any shell in common locations
    const fallbackPaths = ['/bin/sh', '/usr/bin/sh', 'sh'];
    for (const shellPath of fallbackPaths) {
      if (await this._isShellAvailable(shellPath)) {
        logger.warn(`Using fallback shell: ${shellPath}`);
        return shellPath;
      }
    }

    throw new Error('No suitable shell found on this system');
  }

  private async _isShellAvailable(shellPath: string): Promise<boolean> {
    try {
      // If it's an absolute path, check if file exists
      if (path.isAbsolute(shellPath)) {
        await fs.promises.access(shellPath, fs.constants.F_OK | fs.constants.X_OK);
        return true;
      }

      // If it's a command name, try to execute it
      await this._testShell(shellPath, ['-c'], 'echo test');
      return true;
    } catch (error) {
      return false;
    }
  }

  private async _testShell(shell: string, args: string[], command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(shell, [...args, command], {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 5000
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Shell test failed with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Get exec options with the detected shell
   */
  async getExecOptions(additionalOptions: ExecOptions = {}): Promise<ExecOptions> {
    const shell = await this.detectShell();
    
    return {
      ...additionalOptions,
      shell,
      windowsHide: true // Hide cmd windows on Windows
    };
  }

  /**
   * Execute a command using the detected shell
   */
  async execCommand(
    command: string, 
    options: ExecOptions = {}
  ): Promise<ExecResult> {
    try {
      const execOptions = await this.getExecOptions(options);
      const formattedCommand = this.formatCommandForShell(command, execOptions.shell);
      logger.debug(`Executing command with shell ${execOptions.shell}: ${formattedCommand}`);
      
      const { stdout, stderr } = await execAsync(formattedCommand, execOptions);
      
      return {
        success: true,
        stdout: stdout || '',
        stderr: stderr || ''
      };
    } catch (error: any) {
      logger.error(`Command execution failed: ${command}`, error);
      
      return {
        success: false,
        stdout: '',
        stderr: error.stderr || error.message || 'Unknown error',
        code: error.code
      };
    }
  }

  /**
   * Format command for specific shell requirements
   */
  private formatCommandForShell(command: string, shell: string): string {
    // Handle Fish shell special cases
    if (shell && shell.includes('fish')) {
      // Fish shell doesn't expand wildcards in the same way
      // Escape wildcards to prevent globbing errors
      return command.replace(/\*\./g, '\\*\\.');
    }
    
    return command;
  }

  /**
   * Execute a command using the native exec function with proper shell options
   */
  exec(
    command: string,
    options: ExecOptions,
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ): void {
    this.getExecOptions(options).then(execOptions => {
      const formattedCommand = this.formatCommandForShell(command, execOptions.shell);
      exec(formattedCommand, execOptions, callback);
    }).catch(error => {
      logger.error('Failed to get exec options', error);
      // Fallback to original exec without shell specification
      exec(command, options, callback);
    });
  }

  /**
   * Get the current detected shell (synchronous, returns null if not detected yet)
   */
  getCurrentShell(): string | null {
    return this.detectedShell;
  }

  /**
   * Force re-detection of shell (useful for testing or if environment changes)
   */
  resetDetection(): void {
    this.detectedShell = null;
    this.shellDetectionPromise = null;
  }

  /**
   * Check if running on Windows
   */
  isWindows(): boolean {
    return process.platform === 'win32';
  }

  /**
   * Get platform-appropriate command separator
   */
  getCommandSeparator(): string {
    return this.isWindows() ? ' && ' : ' && ';
  }

  /**
   * Escape command arguments for shell execution
   */
  escapeShellArg(arg: string): string {
    if (this.isWindows()) {
      // Windows cmd.exe escaping
      if (arg.includes(' ') || arg.includes('"')) {
        return `"${arg.replace(/"/g, '""')}"`;
      }
      return arg;
    } else {
      // Unix shell escaping
      if (arg.includes(' ') || arg.includes("'") || arg.includes('"') || 
          arg.includes('$') || arg.includes('`') || arg.includes('\\')) {
        return `'${arg.replace(/'/g, "'\\''")}'`;
      }
      return arg;
    }
  }
}

// Export singleton instance
export const shellUtils = new ShellUtility();

// Export class for testing
export { ShellUtility };

// Initialize shell detection early
shellUtils.detectShell().catch(error => {
  logger.error('Failed to detect shell during initialization', error);
});